/**
 * FREQ — Universal Music Player
 * server.js  ·  v4.1  "The Extractor"
 *
 * © 2025–2026 FREQ / Slimey2017. All rights reserved.
 *
 * ─── API Endpoints ────────────────────────────────────────────────────────────
 * POST /api/resolve              { url: string }
 *   → { platform, type, embedUrl, id, title?, embedBlocked? }
 *
 * POST /api/import               { urls: string[] }
 *
 * POST /api/yt/tracks            { url: string }   ← NEW v4.1
 *   → { type:'playlist'|'video', title, tracks:[{ id, title, duration, thumb }] }
 *   Scrapes ytInitialData from YouTube page — zero API key.
 *   Works for: watch?v=, playlist?list=, /channel/, /@handle, youtu.be/
 *
 * GET  /api/yt/embed-check       ?id=<videoId>     ← NEW v4.1
 *   → { id, embeddable: bool, nocookie: bool }
 *   Checks YouTube oEmbed endpoint to detect embedding restrictions.
 *
 * GET  /health
 * GET  /redirect                 ?url=<encoded>&platform=<name>
 *
 * POST /api/auth/signup          { username, displayName?, password }
 * POST /api/auth/signin          { username, password }
 * POST /api/auth/token-refresh   { token }
 * POST /api/auth/sync            { token, playlists }
 * GET  /api/auth/pull
 * DELETE /api/auth/account       { token }
 *
 * ─── New in v4.1 ─────────────────────────────────────────────────────────────
 *   - POST /api/yt/tracks  — scrapes YouTube playlist/video tracks, no API key
 *   - GET  /api/yt/embed-check — detects embed-blocked videos via oEmbed
 *   - resolveYouTube now returns embedBlocked flag + nocookie fallback URL
 *   - All resolvers hardened with better error messages
 *   - Native fetch (Node v18+) for server-side HTTP (scraping)
 *   - User-Agent spoofing so YT page scrape actually works
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const multer   = require('multer');
// node-fetch not needed — Node v18+ has native fetch built in
const { createClient } = require('@supabase/supabase-js');

// ─── Supabase client (server-side only — uses service role key) ───────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '35mb' }));
app.use(express.static(__dirname));

// ─── Multer — memory storage for cloud file uploads ───────────────────────────
// Files land in req.file.buffer; nothing touches disk on the server.
// 20 MB limit mirrors CLOUD_FILE_MAX_BYTES below.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1048576 },   // 20 MB
  fileFilter: (_req, file, cb) => {
    // Accept audio/* and the common container types that browsers may label
    // as application/octet-stream (e.g. .flac, .aiff from some OS pickers)
    const ok = file.mimetype.startsWith('audio/')
      || file.mimetype === 'application/octet-stream'
      || /\.(mp3|flac|aiff?|aac|ogg|opus|wav|m4a|wma|alac)$/i.test(file.originalname);
    cb(null, ok);
  },
});

// ─── Supabase DB helpers ──────────────────────────────────────────────────────
// All auth state now lives in Supabase. No local file, no in-memory Maps.

async function dbGetAccount(username) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('username', username)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getAccount:', error.message);
  return data || null;
}

async function dbCreateAccount(username, displayName, salt, hash) {
  const { error } = await supabase.from('accounts').insert({
    username, display_name: displayName, salt, hash, created_at: new Date().toISOString()
  });
  if (error) throw new Error(error.message);
}

async function dbDeleteAccount(username) {
  // Clean up Storage objects first — deleting the metadata rows without
  // this would orphan the actual audio files in the bucket forever.
  const files = await dbGetCloudFiles(username);
  if (files.length) {
    const paths = files.map(f => f.storage_path);
    const { error } = await supabase.storage.from(CLOUD_BUCKET).remove(paths);
    if (error) console.error('[db] deleteAccount storage cleanup:', error.message);
  }
  await supabase.from('cloud_files').delete().eq('owner', username);
  await supabase.from('sessions').delete().eq('username', username);
  await supabase.from('playlists').delete().eq('username', username);
  await supabase.from('accounts').delete().eq('username', username);
}

async function dbCreateSession(token, username, expiresAt) {
  const { error } = await supabase.from('sessions').insert({
    token, username, expires_at: new Date(expiresAt).toISOString()
  });
  if (error) throw new Error(error.message);
}

async function dbGetSession(token) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('token', token)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getSession:', error.message);
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await supabase.from('sessions').delete().eq('token', token);
    return null;
  }
  return { username: data.username, expiresAt: new Date(data.expires_at).getTime() };
}

async function dbRefreshSession(token, expiresAt) {
  await supabase.from('sessions')
    .update({ expires_at: new Date(expiresAt).toISOString() })
    .eq('token', token);
}

async function dbDeleteSession(token) {
  await supabase.from('sessions').delete().eq('token', token);
}

async function dbGetPlaylists(username) {
  const { data, error } = await supabase
    .from('playlists')
    .select('data')
    .eq('username', username)
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getPlaylists:', error.message);
  return data?.data || [];
}

async function dbSetPlaylists(username, playlists) {
  const { error } = await supabase.from('playlists').upsert(
    { username, data: playlists, updated_at: new Date().toISOString() },
    { onConflict: 'username' }
  );
  if (error) throw new Error(error.message);
}

// ─── Cloud Files (Supabase Storage + Postgres metadata) ───────────────────────
const CLOUD_BUCKET = 'cloud-audio';

async function dbGetCloudFiles(username) {
  const { data, error } = await supabase
    .from('cloud_files')
    .select('*')
    .eq('owner', username)
    .order('uploaded_at', { ascending: false });
  if (error) console.error('[db] getCloudFiles:', error.message);
  return data || [];
}

async function dbGetCloudFile(id, username) {
  const { data, error } = await supabase
    .from('cloud_files')
    .select('*')
    .eq('id', id)
    .eq('owner', username)   // ownership enforced in the query itself, not just checked after
    .single();
  if (error && error.code !== 'PGRST116') console.error('[db] getCloudFile:', error.message);
  return data || null;
}

async function dbInsertCloudFile(row) {
  const { data, error } = await supabase
    .from('cloud_files')
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbDeleteCloudFile(id, username) {
  const { error } = await supabase
    .from('cloud_files')
    .delete()
    .eq('id', id)
    .eq('owner', username);  // same belt-and-suspenders ownership scoping
  if (error) throw new Error(error.message);
}

// schedulePersist is a no-op now — kept so no call sites break
function schedulePersist() {}

// ─── Crypto helpers ───────────────────────────────────────────────────────────
const PBKDF2_ITERS  = 100_000;
const PBKDF2_KEYLEN = 64;

async function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, 'sha256', (err, key) => {
      if (err) reject(err); else resolve(key.toString('hex'));
    });
  });
}

function generateSalt()  { return crypto.randomBytes(16).toString('hex'); }
function generateToken() { return crypto.randomBytes(16).toString('hex'); }

const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

// resolveToken is now a thin alias for dbGetSession — kept for any call sites
// that were not auth routes (there are none, but just in case)
async function resolveToken(token) {
  if (!token) return null;
  return dbGetSession(token);
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip     = req.ip || req.connection.remoteAddress || 'unknown';
  const now    = Date.now();
  const window = 60_000;
  const max    = 120;
  if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
  const hits = rateLimitMap.get(ip).filter(t => now - t < window);
  hits.push(now);
  rateLimitMap.set(ip, hits);
  if (hits.length > max) return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateLimitMap) {
    const fresh = hits.filter(t => now - t < 60_000);
    if (!fresh.length) rateLimitMap.delete(ip); else rateLimitMap.set(ip, fresh);
  }
}, 300_000);

// ─── HTTP fetch helper (spoofs browser UA so YT doesn't block) ────────────────
const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchHTML(url, timeoutMs = 8000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': YT_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        // Bypass GDPR/cookie consent gate that returns empty ytInitialData
        'Cookie': 'CONSENT=YES+; SOCS=CAESEwgDEgk0OTA3NzkzMjQaAmVuIAEaBgiAo_CmBg==',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ─── YouTube page scraper — extracts ytInitialData ────────────────────────────
/**
 * Parses YouTube's ytInitialData JSON embedded in the page source.
 * Returns parsed object or null.
 */
function extractYtInitialData(html) {
  // Strategy 1: find the var / window assignment, then balance braces to capture full JSON
  const starts = [
    /var ytInitialData\s*=\s*\{/,
    /window\["ytInitialData"\]\s*=\s*\{/,
    /ytInitialData\s*=\s*\{/,
  ];
  for (const pat of starts) {
    const m = html.search(pat);
    if (m === -1) continue;
    const start = html.indexOf('{', m);
    if (start === -1) continue;
    let depth = 0, i = start, inStr = false, escape = false;
    for (; i < html.length; i++) {
      const c = html[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    try { return JSON.parse(html.slice(start, i + 1)); } catch { continue; }
  }
  return null;
}

/**
 * Walks ytInitialData to find all videoRenderer / playlistVideoRenderer objects.
 * Returns array of { id, title, duration, thumb }.
 */
function extractTracksFromYtData(data) {
  const tracks = [];
  const seen   = new Set();

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    // playlistVideoRenderer (playlist page)
    if (obj.playlistVideoRenderer) {
      const r  = obj.playlistVideoRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title    = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const durText  = r.lengthText?.simpleText || r.lengthText?.runs?.[0]?.text || null;
        const thumbs   = r.thumbnail?.thumbnails || [];
        const thumb    = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }
    // videoRenderer (search results / channel page)
    if (obj.videoRenderer) {
      const r  = obj.videoRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title   = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const durText = r.lengthText?.simpleText || null;
        const thumbs  = r.thumbnail?.thumbnails || [];
        const thumb   = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }
    // gridVideoRenderer (channel videos tab)
    if (obj.gridVideoRenderer) {
      const r  = obj.gridVideoRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title   = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const durText = r.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || null;
        const thumbs  = r.thumbnail?.thumbnails || [];
        const thumb   = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }
    // reelsItemRenderer (Shorts)
    if (obj.reelsItemRenderer) {
      const r  = obj.reelsItemRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title = r.headline?.simpleText || r.accessibility?.accessibilityData?.label || 'Short';
        const thumbs = r.thumbnail?.thumbnails || [];
        const thumb  = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: null, thumb });
      }
    }
    // richItemRenderer (home feed / shorts shelf)
    if (obj.richItemRenderer) walk(obj.richItemRenderer.content);

    // ── YouTube Music renderers ──────────────────────────────────────────────
    // musicVideoRenderer (YT Music search results / album tracks)
    if (obj.musicVideoRenderer) {
      const r  = obj.musicVideoRenderer;
      const id = r.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title   = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const durText = r.lengthText?.runs?.[0]?.text || r.lengthText?.simpleText || null;
        const thumbs  = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
          || r.thumbnail?.thumbnails || [];
        const thumb   = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }
    // musicTwoRowItemRenderer (YT Music playlists / album grid)
    if (obj.musicTwoRowItemRenderer) {
      const r         = obj.musicTwoRowItemRenderer;
      const navEp     = r.navigationEndpoint?.watchEndpoint
        || r.navigationEndpoint?.watchPlaylistEndpoint;
      const id        = navEp?.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const title   = r.title?.runs?.[0]?.text || r.title?.simpleText || 'Unknown';
        const thumbs  = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails
          || r.thumbnail?.thumbnails || [];
        const thumb   = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: null, thumb });
      }
    }
    // musicResponsiveListItemRenderer (YT Music queue / playlist page rows)
    if (obj.musicResponsiveListItemRenderer) {
      const r      = obj.musicResponsiveListItemRenderer;
      const ovEp   = r.overlay?.musicItemThumbnailOverlayRenderer
        ?.startMusicPlayCommand?.watchEndpoint;
      const flexEp = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
        ?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint;
      const id     = ovEp?.videoId || flexEp?.videoId;
      if (id && !seen.has(id)) {
        seen.add(id);
        const titleRun = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
          ?.text?.runs?.[0];
        const title    = titleRun?.text || 'Unknown';
        // Duration is usually in flexColumns[1] or fixedColumns[0]
        const durRun   = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer
          ?.text?.runs?.[0]
          || r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer
          ?.text?.runs?.[0];
        const durText  = durRun?.text || null;
        const thumbs   = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
          || r.thumbnail?.thumbnails || [];
        const thumb    = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        tracks.push({ id, title, duration: durText, thumb });
      }
    }

    // Recurse into arrays and objects
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === 'object') walk(v);
    }
  }

  walk(data);
  return tracks;
}

/**
 * Extract playlist title from ytInitialData.
 */
function extractPlaylistTitle(data) {
  try {
    // playlist page: sidebar has metadata
    const header = data?.header?.playlistHeaderRenderer
      || data?.sidebar?.playlistSidebarRenderer?.items?.[0]?.playlistSidebarPrimaryInfoRenderer;
    if (header?.title?.runs?.[0]?.text) return header.title.runs[0].text;
    if (header?.title?.simpleText)      return header.title.simpleText;
    // microformat
    const mf = data?.microformat?.microformatDataRenderer;
    if (mf?.title) return mf.title;
  } catch {}
  return null;
}

// ─── YouTube oEmbed embed-check ───────────────────────────────────────────────
/**
 * Checks whether a YouTube video ID can be embedded.
 * Uses oEmbed endpoint — if it returns 401/403 or the response has
 * "Video not found" it means embedding is disabled.
 * Free, no API key.
 */
async function checkYtEmbeddable(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': YT_UA } });
    if (res.status === 401 || res.status === 403) return { embeddable: false };
    if (!res.ok) return { embeddable: false };
    const data = await res.json();
    // If the title is returned it's embeddable
    return { embeddable: true, title: data.title || null, thumb: data.thumbnail_url || null };
  } catch {
    return { embeddable: false };
  }
}

// ─── Platform Detection ───────────────────────────────────────────────────────
function detectPlatform(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^www\./, '');
    if (h === 'music.youtube.com')                          return 'ytmusic';
    if (h === 'youtube.com' || h === 'youtu.be')            return 'youtube';
    if (h === 'open.spotify.com')                           return 'spotify';
    if (h === 'tidal.com')                                  return 'tidal';
    if (h === 'soundcloud.com')                             return 'soundcloud';
    if (h === 'music.apple.com')                            return 'applemusic';
    if (h === 'music.amazon.com')                           return 'amazon';
    if (h === 'open.qobuz.com' || h === 'play.qobuz.com')  return 'qobuz';
    if (h === 'deezer.com' || h === 'www.deezer.com')       return 'deezer';
    if (h === 'last.fm' || h === 'www.last.fm')             return 'lastfm';
  } catch (_) {}
  return null;
}

// ─── Embed URL Builders ───────────────────────────────────────────────────────

/**
 * resolveYouTube — v4.1
 * - Returns both standard and nocookie embed URLs
 * - Detects playlist vs video
 * - Sets title from URL when possible
 */
function resolveYouTube(url) {
  const u = new URL(url);

  // YT Music browse paths  e.g. /browse/VLPL...
  const browsePath = u.pathname.match(/^\/browse\/(VL[A-Za-z0-9_-]+)/);
  if (browsePath) {
    const listId = browsePath[1].replace(/^VL/, '');
    return buildYtPlaylistResult(listId, url);
  }

  const listId  = u.searchParams.get('list');
  const videoId = u.searchParams.get('v')
    || (u.hostname === 'youtu.be' ? u.pathname.replace(/^\//, '').split('?')[0] : null);

  // Playlist (possibly with a starting video)
  if (listId && !videoId) return buildYtPlaylistResult(listId, url);

  // Video (possibly also in a playlist — treat as video)
  if (videoId && videoId.length >= 11) return buildYtVideoResult(videoId, listId, url);

  // Shorts /shorts/<id>
  const shortsMatch = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
  if (shortsMatch) return buildYtVideoResult(shortsMatch[1], null, url);

  // Channel / handle pages: not directly playable, return as link for track-fetch
  const channelMatch = u.pathname.match(/^\/@([^/]+)|^\/channel\/([A-Za-z0-9_-]+)/);
  if (channelMatch) {
    const handle = channelMatch[1] || channelMatch[2];
    return {
      type: 'channel',
      embedUrl: `/redirect?url=${encodeURIComponent(url)}&platform=youtube`,
      id: handle,
      title: `@${handle}`,
      canFetchTracks: true,
    };
  }

  return null;
}

function buildYtVideoResult(videoId, listId, originalUrl) {
  const params = new URLSearchParams({
    autoplay: '1', controls: '1', enablejsapi: '1', origin: 'https://freq.app',
    ...(listId ? { list: listId } : {}),
  });
  return {
    type:        'video',
    embedUrl:    `https://www.youtube.com/embed/${videoId}?${params}`,
    embedUrlNC:  `https://www.youtube-nocookie.com/embed/${videoId}?${params}`, // nocookie fallback
    id:          videoId,
    canFetchTracks: false,
  };
}

function buildYtPlaylistResult(listId, originalUrl) {
  const params = new URLSearchParams({ list: listId, autoplay: '1', controls: '1' });
  return {
    type:        'playlist',
    embedUrl:    `https://www.youtube.com/embed/videoseries?${params}`,
    embedUrlNC:  `https://www.youtube-nocookie.com/embed/videoseries?${params}`,
    id:          listId,
    canFetchTracks: true,
  };
}

function resolveSpotify(url) {
  const match = new URL(url).pathname.match(/^\/(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return { type, embedUrl:`https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`, id };
}

function resolveTidal(url) {
  const match = new URL(url).pathname.match(/\/(playlist|album|track)\/([^/?]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return { type, embedUrl:`https://embed.tidal.com/${type}s/${id}`, id };
}

function resolveSoundCloud(url) {
  const type = (url.includes('/sets/') || url.includes('/likes/')) ? 'playlist' : 'track';
  const params = new URLSearchParams({
    url, color:'%23ff5500', auto_play:'true', hide_related:'false',
    show_comments:'true', show_user:'true', show_reposts:'false', show_teaser:'true', visual:'true',
  });
  return { type, embedUrl:`https://w.soundcloud.com/player/?${params.toString()}`, id:url };
}

function resolveAppleMusic(url) {
  const u = new URL(url);
  // Strip locale path prefix if present (e.g. /us/album/...)
  // Normalise to global embed
  const playlistMatch = u.pathname.match(/^\/([a-z]{2})\/playlist\/(?:[^/]*\/)?(pl\.[A-Za-z0-9]+)/);
  if (playlistMatch) {
    const [, country, id] = playlistMatch;
    return { type:'playlist', embedUrl:`https://embed.music.apple.com/${country}/playlist/${id}`, id };
  }
  const albumMatch = u.pathname.match(/^\/([a-z]{2})\/(?:album|song)\/(?:[^/]*\/)?([\d]+)/);
  if (!albumMatch) {
    // try without locale
    const noLocale = u.pathname.match(/^\/((?:album|song|playlist)\/[^?]+)/);
    if (noLocale) return { type:'link', embedUrl:`https://embed.music.apple.com/${noLocale[1]}`, id:noLocale[1] };
    return null;
  }
  const [, country, id] = albumMatch;
  const trackId = u.searchParams.get('i');
  if (trackId) return { type:'track', embedUrl:`https://embed.music.apple.com/${country}/album/${id}?i=${trackId}`, id };
  return { type:'album', embedUrl:`https://embed.music.apple.com/${country}/album/${id}`, id };
}

function resolveAmazon(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(playlists?|albums?|tracks?|artists?)\/([^/?]+)/i);
  let type = 'link', id = url;
  if (match) { type = match[1].replace(/s$/, '').toLowerCase(); id = match[2]; }
  return { type, embedUrl:`/redirect?url=${encodeURIComponent(url)}&platform=amazon`, id };
}

function resolveQobuz(url) {
  const match = new URL(url).pathname.match(/\/(album|playlist|track)\/([^/?]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return { type, embedUrl:`/redirect?url=${encodeURIComponent(url)}&platform=qobuz`, id };
}

function resolveDeezer(url) {
  const u = new URL(url);
  const match = u.pathname.match(/(?:\/[a-z]{2})?\/?(track|playlist|album|artist|radio)\/([0-9]+)/i);
  if (!match) return null;
  const [, rawType, id] = match;
  const type = rawType.toLowerCase();
  return {
    type,
    embedUrl: `https://widget.deezer.com/widget/dark/${type}/${id}`,
    id,
  };
}

function resolveLastFm(url) {
  const u = new URL(url);
  const pathname = u.pathname;
  let type = 'link', id = url;

  const musicMatch = pathname.match(/^\/music\/([^/]+)(?:\/_\/([^/]+)|\/([^/]+))?/);
  const userMatch  = pathname.match(/^\/user\/([^/]+)/);
  const tagMatch   = pathname.match(/^\/tag\/([^/]+)/);

  if (musicMatch) {
    const [, artist, track, album] = musicMatch;
    if (track)      { type = 'track';  id = decodeURIComponent(artist) + ' — ' + decodeURIComponent(track); }
    else if (album) { type = 'album';  id = decodeURIComponent(artist) + ' · ' + decodeURIComponent(album); }
    else            { type = 'artist'; id = decodeURIComponent(artist); }
  } else if (userMatch) {
    type = 'profile'; id = decodeURIComponent(userMatch[1]);
  } else if (tagMatch) {
    type = 'tag'; id = decodeURIComponent(tagMatch[1]);
  }

  return {
    type,
    embedUrl: `/redirect?url=${encodeURIComponent(url)}&platform=lastfm`,
    id,
  };
}

// ─── Resolver Map ─────────────────────────────────────────────────────────────
const RESOLVERS = {
  youtube:    resolveYouTube,
  ytmusic:    resolveYouTube,
  spotify:    resolveSpotify,
  tidal:      resolveTidal,
  soundcloud: resolveSoundCloud,
  applemusic: resolveAppleMusic,
  amazon:     resolveAmazon,
  qobuz:      resolveQobuz,
  deezer:     resolveDeezer,
  lastfm:     resolveLastFm,
};

// ─── Redirect Brand Config ────────────────────────────────────────────────────
const REDIRECT_BRANDS = {
  amazon:  { name:'Amazon Music', color:'#00A8E1', bgColor:'#0f1923', emoji:'◈' },
  qobuz:   { name:'Qobuz',        color:'#05b8cc', bgColor:'#050f14', emoji:'◉' },
  lastfm:  { name:'Last.fm',      color:'#d51007', bgColor:'#0e0505', emoji:'⊕' },
  youtube: { name:'YouTube',      color:'#ff0000', bgColor:'#0a0000', emoji:'▶' },
};

app.get('/redirect', (req, res) => {
  const targetUrl = req.query.url    || '';
  const platform  = req.query.platform || 'amazon';
  const brand     = REDIRECT_BRANDS[platform] || REDIRECT_BRANDS.amazon;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="3;url=${encodeURI(decodeURIComponent(targetUrl))}">
  <title>${brand.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Unbounded:wght@700;900&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{background:${brand.bgColor};font-family:'Space Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:22px;color:#fff;padding:32px;}
    .icon{font-size:3rem;}
    .badge{background:${brand.color};color:#000;font-family:'Unbounded',sans-serif;font-weight:900;font-size:0.65rem;padding:5px 14px;border-radius:3px;letter-spacing:0.18em;text-transform:uppercase;}
    h2{font-family:'Unbounded',sans-serif;font-size:1.1rem;letter-spacing:-0.01em;text-align:center;}
    p{color:#778;font-size:0.75rem;text-align:center;line-height:1.8;}
    a{color:${brand.color};text-decoration:none;font-weight:700;}
    a:hover{text-decoration:underline;}
    .bar-wrap{width:220px;height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;}
    .bar-fill{height:100%;background:${brand.color};border-radius:2px;animation:fill 3s linear forwards;}
    @keyframes fill{from{width:0%;}to{width:100%;}}
    .note{font-size:0.62rem;color:#444;margin-top:8px;text-align:center;line-height:1.9;}
  </style>
</head>
<body>
  <div class="icon">${brand.emoji}</div>
  <div class="badge">${brand.name}</div>
  <h2>Opening in ${brand.name}…</h2>
  <div class="bar-wrap"><div class="bar-fill"></div></div>
  <p>Redirecting automatically.<br><a href="${decodeURIComponent(targetUrl)}" target="_blank">Click here</a> if it doesn't open.</p>
  <p class="note">${brand.name} doesn't support embedded playback in third-party apps.<br>Your link will open in a new tab.</p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  // Live account count from Supabase (best-effort — don't fail the health check)
  let accounts = 0;
  try {
    const { count } = await supabase.from('accounts').select('*', { count: 'exact', head: true });
    accounts = count || 0;
  } catch (_) {}
  res.json({
    status:   'ok',
    version:  '4.3',
    uptime:   Math.floor(process.uptime()),
    platform: process.platform,
    accounts,
  });
});

// ─── POST /api/resolve ────────────────────────────────────────────────────────
app.post('/api/resolve', rateLimit, (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ error: 'Request body must include a "url" string.' });

  const trimmed  = url.trim();
  const platform = detectPlatform(trimmed);
  if (!platform)
    return res.status(400).json({
      error: 'Unsupported platform. Paste a URL from YouTube, YT Music, Spotify, Tidal, SoundCloud, Apple Music, Amazon Music, Qobuz, Deezer, or Last.fm.',
    });

  try {
    const info = RESOLVERS[platform](trimmed);
    if (!info) return res.status(400).json({ error: `Could not extract a playable ID from this ${platform} URL. Check that the link is public and not a redirect.` });
    return res.json({ platform, originalUrl: trimmed, ...info });
  } catch (err) {
    console.error(`[resolve] ${platform}:`, err.message);
    return res.status(400).json({ error: `Could not parse this URL: ${err.message}` });
  }
});

// ─── POST /api/import (batch) ─────────────────────────────────────────────────
app.post('/api/import', rateLimit, (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || !urls.length)
    return res.status(400).json({ error: 'Request body must include a "urls" array.' });
  if (urls.length > 200)
    return res.status(400).json({ error: 'Maximum 200 URLs per import.' });

  const results = urls.map(rawUrl => {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { error:'Invalid URL', url:rawUrl };
    const trimmed  = rawUrl.trim();
    const platform = detectPlatform(trimmed);
    if (!platform) return { error:'Unsupported platform', url:trimmed };
    try {
      const info = RESOLVERS[platform](trimmed);
      if (!info) return { error:'Could not parse URL', url:trimmed };
      return { platform, originalUrl:trimmed, ...info };
    } catch (err) {
      return { error:err.message, url:trimmed };
    }
  });

  return res.json({
    succeeded: results.filter(r => !r.error),
    failed:    results.filter(r =>  r.error),
    total:     results.length,
  });
});

// ─── POST /api/yt/tracks  (NEW v4.1) ─────────────────────────────────────────
/**
 * Body: { url: string }
 * Returns: { type, title, tracks: [{ id, title, duration, thumb, embedUrl }] }
 *
 * Strategy:
 *   1. Fetch the YouTube page HTML with a browser UA
 *   2. Extract ytInitialData JSON
 *   3. Walk it to collect all video renderers
 *   4. Return track list — client decides which to queue
 *
 * Supports: watch?v=, playlist?list=, /shorts/, /@handle, /channel/
 */
app.post('/api/yt/tracks', rateLimit, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ error: '"url" required.' });

  const trimmed = url.trim();
  // Only allow YouTube URLs
  const platform = detectPlatform(trimmed);
  if (platform !== 'youtube' && platform !== 'ytmusic')
    return res.status(400).json({ error: 'Only YouTube / YT Music URLs are supported for track listing.' });

  // Normalise: ensure we're fetching the right page
  let fetchUrl = trimmed;
  try {
    const u = new URL(trimmed);
    // For a single video, fetch the video page — it shows related/playlist tracks
    // For a playlist, fetch playlist?list=...
    if (!u.searchParams.get('list') && !u.pathname.startsWith('/playlist')) {
      // Single video page — we'll get the "Up next" / playlist continuation
      // Just use the URL as-is
    }
    // YT Music → convert to regular youtube.com for scraping
    if (u.hostname === 'music.youtube.com') {
      u.hostname = 'www.youtube.com';
      fetchUrl = u.toString();
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  console.log(`[yt/tracks] Fetching: ${fetchUrl}`);

  try {
    const html = await fetchHTML(fetchUrl, 10000);

    if (!html || html.length < 1000) {
      return res.status(502).json({ error: 'YouTube returned an empty response. Try again.' });
    }

    if (html.includes('Sorry, something went wrong') || html.includes('Our systems have detected unusual traffic')) {
      return res.status(429).json({ error: 'YouTube rate limited. Please wait a moment and try again.' });
    }

    const ytData = extractYtInitialData(html);
    if (!ytData) {
      return res.status(502).json({ error: 'Could not parse YouTube page data. The page structure may have changed.' });
    }

    const tracks = extractTracksFromYtData(ytData);
    const title  = extractPlaylistTitle(ytData) || null;

    if (!tracks.length) {
      return res.status(404).json({ error: 'No tracks found on this page. The playlist may be private or empty.' });
    }

    // Build embedUrl for each track
    const tracksWithEmbed = tracks.map(t => ({
      ...t,
      embedBlocked: false,    // default; player updates via /api/yt/embed-check at playback time
      embedUrl:   `https://www.youtube.com/embed/${t.id}?autoplay=1&controls=1&enablejsapi=1`,
      embedUrlNC: `https://www.youtube-nocookie.com/embed/${t.id}?autoplay=1&controls=1&enablejsapi=1`,
      originalUrl: `https://www.youtube.com/watch?v=${t.id}`,
      platform:   'youtube',
      type:       'video',
    }));

    console.log(`[yt/tracks] Found ${tracksWithEmbed.length} tracks, title: "${title}"`);

    return res.json({
      type:   'playlist',
      title:  title || 'YouTube Playlist',
      tracks: tracksWithEmbed,
      total:  tracksWithEmbed.length,
      sourceUrl: trimmed,
    });

  } catch (err) {
    console.error('[yt/tracks] Error:', err.message);
    return res.status(502).json({ error: `Could not fetch YouTube page: ${err.message}` });
  }
});

// ─── GET /api/yt/embed-check  (NEW v4.1) ─────────────────────────────────────
/**
 * Query: ?id=<videoId>
 * Returns: { id, embeddable: bool, title?, thumb? }
 *
 * Uses YouTube's free oEmbed endpoint — no API key needed.
 * 401/403 = embedding disabled by uploader.
 */
app.get('/api/yt/embed-check', rateLimit, async (req, res) => {
  const { id } = req.query;
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
    return res.status(400).json({ error: 'Valid YouTube video ID required.' });

  try {
    const result = await checkYtEmbeddable(id);
    return res.json({ id, ...result });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES  — Supabase-backed
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/signup', rateLimit, async (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const key = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!key || key.length < 2)
    return res.status(400).json({ error: 'Username must be 2+ alphanumeric chars or underscores.' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  try {
    const existing = await dbGetAccount(key);
    if (existing) return res.status(409).json({ error: 'Username already taken.' });

    const salt        = generateSalt();
    const hash        = await hashPassword(password, salt);
    const dName       = (displayName || '').trim() || key;
    await dbCreateAccount(key, dName, salt, hash);
    await dbSetPlaylists(key, []);

    const token     = generateToken();
    const expiresAt = Date.now() + TOKEN_TTL;
    await dbCreateSession(token, key, expiresAt);

    return res.status(201).json({ token, username: key, displayName: dName });
  } catch (err) {
    console.error('[signup]', err);
    return res.status(500).json({ error: 'Server error during signup.' });
  }
});

app.post('/api/auth/signin', rateLimit, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const key  = username.trim().toLowerCase();
  try {
    const acct = await dbGetAccount(key);
    if (!acct) return res.status(401).json({ error: 'No account found with that username.' });

    const hash = await hashPassword(password, acct.salt);
    if (hash !== acct.hash) return res.status(401).json({ error: 'Incorrect password.' });

    const token     = generateToken();
    const expiresAt = Date.now() + TOKEN_TTL;
    await dbCreateSession(token, key, expiresAt);
    const playlists = await dbGetPlaylists(key);

    return res.json({ token, username: key, displayName: acct.display_name, playlists });
  } catch (err) {
    console.error('[signin]', err);
    return res.status(500).json({ error: 'Server error during sign in.' });
  }
});

app.post('/api/auth/token-refresh', async (req, res) => {
  const { token } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  const expiresAt = Date.now() + TOKEN_TTL;
  await dbRefreshSession(token, expiresAt);
  return res.json({ ok: true, expiresAt });
});

app.post('/api/auth/sync', async (req, res) => {
  const { token, playlists } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!Array.isArray(playlists)) return res.status(400).json({ error: '"playlists" must be an array.' });
  if (JSON.stringify(playlists).length > 2_000_000)
    return res.status(413).json({ error: 'Playlist data exceeds 2 MB limit.' });
  try {
    await dbSetPlaylists(sess.username, playlists);
    return res.json({ ok: true, synced: playlists.length, syncedAt: Date.now() });
  } catch (err) {
    console.error('[sync]', err);
    return res.status(500).json({ error: 'Sync failed.' });
  }
});

app.get('/api/auth/pull', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const acct      = await dbGetAccount(sess.username);
    const playlists = await dbGetPlaylists(sess.username);
    return res.json({
      username:    sess.username,
      displayName: acct?.display_name || sess.username,
      playlists,
      pulledAt:    Date.now(),
    });
  } catch (err) {
    console.error('[pull]', err);
    return res.status(500).json({ error: 'Pull failed.' });
  }
});

app.delete('/api/auth/account', async (req, res) => {
  const token = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    await dbDeleteAccount(sess.username);
    return res.json({ ok: true, deleted: sess.username });
  } catch (err) {
    console.error('[delete-account]', err);
    return res.status(500).json({ error: 'Account deletion failed.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CLOUD FILES  — Supabase Storage (private bucket) + Postgres metadata
//  POST   /api/cloud-files        { token, filename, mimeType, data }  data = base64 data URL
//  GET    /api/cloud-files        ?token=...   → list of { id, filename, size, mimeType, uploadedAt }
//  GET    /api/cloud-files/:id    ?token=...   → { ...metadata, url } url = short-lived signed URL
//  DELETE /api/cloud-files/:id    { token }
// ═══════════════════════════════════════════════════════════════════════════════

const CLOUD_FILE_MAX_BYTES = 20 * 1048576; // 20MB, matches client-side cap
const SIGNED_URL_TTL_SECONDS = 60 * 10;    // 10 minutes — long enough to start playback, short enough to limit exposure if a link leaks

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

app.post('/api/cloud-files', rateLimit, (req, res, next) => {
  // ── multipart path (new) ──────────────────────────────────────────────────
  // Content-Type: multipart/form-data  →  fields: token, filename(optional)
  //                                        file:   the audio file
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    upload.single('file')(req, res, async (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: 'File exceeds 20 MB limit.' });
      if (err) return res.status(400).json({ error: err.message });

      const token    = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
      const sess     = await dbGetSession(token);
      if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });

      if (!req.file) return res.status(400).json({ error: 'No file received.' });

      const originalName = req.body.filename || req.file.originalname || 'audio';
      const mimeType     = req.file.mimetype === 'application/octet-stream'
        ? guessMimeFromName(originalName)
        : req.file.mimetype;

      const safeName    = String(originalName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
      const storagePath = `${sess.username}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`;

      try {
        const { error: uploadErr } = await supabase.storage
          .from(CLOUD_BUCKET)
          .upload(storagePath, req.file.buffer, { contentType: mimeType, upsert: false });
        if (uploadErr) throw new Error(uploadErr.message);

        const row = await dbInsertCloudFile({
          owner:        sess.username,
          filename:     String(originalName).slice(0, 255),
          mime_type:    mimeType,
          size:         req.file.size,
          storage_path: storagePath,
          uploaded_at:  new Date().toISOString(),
        });

        return res.status(201).json({
          id: row.id, filename: row.filename, size: row.size,
          mimeType: row.mime_type, uploadedAt: row.uploaded_at,
        });
      } catch (e) {
        console.error('[cloud-files multipart upload]', e);
        return res.status(500).json({ error: 'Upload failed: ' + e.message });
      }
    });
    return; // multer handles the response above
  }

  // ── base64 / JSON path (legacy fallback) ─────────────────────────────────
  // Content-Type: application/json  →  { token, filename, data: "data:audio/...;base64,..." }
  next();
}, async (req, res) => {
  const { token, filename, data } = req.body;
  const sess = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!filename || !data) return res.status(400).json({ error: '"filename" and "data" are required.' });

  const parsed = parseDataUrl(data);
  if (!parsed) return res.status(400).json({ error: '"data" must be a base64 data URL.' });
  if (parsed.buffer.length > CLOUD_FILE_MAX_BYTES)
    return res.status(413).json({ error: `File exceeds ${CLOUD_FILE_MAX_BYTES / 1048576}MB limit.` });

  const safeName    = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
  const storagePath = `${sess.username}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

  try {
    const { error: uploadErr } = await supabase.storage
      .from(CLOUD_BUCKET)
      .upload(storagePath, parsed.buffer, { contentType: parsed.mimeType, upsert: false });
    if (uploadErr) throw new Error(uploadErr.message);

    const row = await dbInsertCloudFile({
      owner: sess.username,
      filename: String(filename).slice(0, 255),
      mime_type: parsed.mimeType,
      size: parsed.buffer.length,
      storage_path: storagePath,
      uploaded_at: new Date().toISOString(),
    });

    return res.status(201).json({
      id: row.id, filename: row.filename, size: row.size,
      mimeType: row.mime_type, uploadedAt: row.uploaded_at,
    });
  } catch (err) {
    console.error('[cloud-files upload]', err);
    return res.status(500).json({ error: 'Upload failed.' });
  }
});

app.get('/api/cloud-files', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    const files = await dbGetCloudFiles(sess.username);
    return res.json({
      files: files.map(f => ({
        id: f.id, filename: f.filename, size: f.size,
        mimeType: f.mime_type, uploadedAt: f.uploaded_at,
      })),
    });
  } catch (err) {
    console.error('[cloud-files list]', err);
    return res.status(500).json({ error: 'Could not load cloud files.' });
  }
});

app.get('/api/cloud-files/:id', async (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  try {
    // .eq('owner', sess.username) is inside dbGetCloudFile itself — a file that
    // exists but belongs to someone else returns null here, identically to a
    // file that doesn't exist at all. No way to distinguish the two by probing.
    const file = await dbGetCloudFile(req.params.id, sess.username);
    if (!file) return res.status(404).json({ error: 'File not found.' });

    const { data, error } = await supabase.storage
      .from(CLOUD_BUCKET)
      .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(error.message);

    return res.json({
      id: file.id, filename: file.filename, size: file.size,
      mimeType: file.mime_type, uploadedAt: file.uploaded_at,
      url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[cloud-files signed-url]', err);
    return res.status(500).json({ error: 'Could not generate playback URL.' });
  }
});

app.delete('/api/cloud-files/:id', async (req, res) => {
  const token = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = await dbGetSession(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });
  try {
    const file = await dbGetCloudFile(req.params.id, sess.username);
    if (!file) return res.status(404).json({ error: 'File not found.' });

    const { error: removeErr } = await supabase.storage.from(CLOUD_BUCKET).remove([file.storage_path]);
    if (removeErr) console.error('[cloud-files delete] storage:', removeErr.message);

    await dbDeleteCloudFile(req.params.id, sess.username);
    return res.json({ ok: true, deleted: file.filename });
  } catch (err) {
    console.error('[cloud-files delete]', err);
    return res.status(500).json({ error: 'Delete failed.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  NAMED INDEXES  — server-curated playlists fetchable by slug
//  GET /api/index/:name  → { name, tracks: [...], total, fetchedAt }
//  GET /api/index        → { indexes: ['flex', ...] }
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Each entry is a resolved track object identical to what /api/resolve returns.
 * Add more named indexes below by adding a new key.
 */
const NAMED_INDEXES = {
  // Add named indexes here. Each key is the URL slug (e.g. 'flex', 'chill').
  // Tracks use the same shape as /api/resolve responses.
  //
  // Example:
  // flex: {
  //   label:       'FLEX',
  //   description: 'The FREQ FLEX showcase playlist.',
  //   tracks: [
  //     {
  //       platform: 'youtube', type: 'video', id: 'abc123',
  //       originalUrl: 'https://www.youtube.com/watch?v=abc123',
  //       embedUrl:    'https://www.youtube.com/embed/abc123?autoplay=1&controls=1&enablejsapi=1',
  //       embedUrlNC:  'https://www.youtube-nocookie.com/embed/abc123?autoplay=1&controls=1&enablejsapi=1',
  //       title:       'Track Title',
  //     },
  //   ],
  // },
};

// GET /api/index  — list all available named indexes
app.get('/api/index', (req, res) => {
  const indexes = Object.entries(NAMED_INDEXES).map(([slug, idx]) => ({
    slug,
    label:       idx.label,
    description: idx.description || '',
    total:       idx.tracks.length,
  }));
  return res.json({ indexes });
});

// GET /index  — alias for /api/index to support legacy or direct index routes
app.get('/index', (req, res) => {
  const indexes = Object.entries(NAMED_INDEXES).map(([slug, idx]) => ({
    slug,
    label:       idx.label,
    description: idx.description || '',
    total:       idx.tracks.length,
  }));
  return res.json({ indexes });
});

function getNamedIndexResponse(slug) {
  const idx = NAMED_INDEXES[slug];
  if (!idx) {
    return { status: 404, body: {
      error: `No index named "${slug}". Available: ${Object.keys(NAMED_INDEXES).join(', ')}`,
    } };
  }
  return { status: 200, body: {
    name:        slug,
    label:       idx.label,
    description: idx.description || '',
    tracks:      idx.tracks,
    total:       idx.tracks.length,
    fetchedAt:   Date.now(),
  } };
}

// GET /api/index/:name  — fetch a named index by slug
app.get('/api/index/:name', (req, res) => {
  const slug = req.params.name.toLowerCase().trim();
  const result = getNamedIndexResponse(slug);
  return res.status(result.status).json(result.body);
});

// GET /index/:name  — alias for /api/index/:name
app.get('/index/:name', (req, res) => {
  const slug = req.params.name.toLowerCase().trim();
  const result = getNamedIndexResponse(slug);
  return res.status(result.status).json(result.body);
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵  FREQ v4.3 "The Extractor" is running`);
  console.log(`    Local:  http://localhost:${PORT}`);
  console.log(`    Health: http://localhost:${PORT}/health`);
  console.log(`    Store:  Supabase (persistent)`);
  console.log(`    © 2025–2026 FREQ / Slimey2017. All rights reserved.\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is already in use.\n   Run:  PORT=3001 node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
