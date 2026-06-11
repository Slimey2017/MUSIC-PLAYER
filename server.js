/**
 * FREQ — Universal Music Player
 * server.js  ·  v4.1  "Sigma+"
 *
 * © 2025–2026 FREQ / Slimey2017. All rights reserved.
 *
 * ─── API Endpoints ────────────────────────────────────────────────────────────
 * POST /api/resolve              { url: string }
 * POST /api/import               { urls: string[] }
 * GET  /api/yt/playlist          ?listId=<playlistId>[&pageToken=<token>]
 * GET  /api/yt/search            ?q=<query>[&limit=<n>]
 * GET  /health
 * GET  /redirect                 ?url=<encoded>&platform=<name>
 *
 * POST /api/auth/signup          { username, displayName?, password }
 * POST /api/auth/signin          { username, password }
 * POST /api/auth/token-refresh   { token }
 * POST /api/auth/sync            { token, playlists }
 * GET  /api/auth/pull            ?token=<token>
 * DELETE /api/auth/account       { token }
 *
 * ─── New in v4.1 ─────────────────────────────────────────────────────────────
 *   - GET /api/yt/playlist  — scrapes YouTube InnerTube API (no key) to expand
 *     a playlist/album into individual track {id, title, artist} objects.
 *     Supports continuation tokens for playlists > 100 tracks.
 *   - GET /api/yt/search    — finds alternate YouTube videos by title query,
 *     used as a fallback when a queued video is blocked/unavailable.
 *   - resolveYouTube() now returns expandable:true for playlist/album types
 *     so the client knows to call /api/yt/playlist to expand it.
 *
 * Supported platforms:
 *   YouTube · YT Music · Spotify · Tidal · SoundCloud · Apple Music
 *   Amazon Music · Qobuz · Deezer · Last.fm
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const https    = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── InnerTube API Helpers ────────────────────────────────────────────────────
// Uses YouTube's internal web API — no API key required.
// client version spoofed as a standard web client.

const INNERTUBE_CLIENT = {
  clientName:    'WEB',
  clientVersion: '2.20240304.00.00',
  hl:            'en',
  gl:            'US',
};

const INNERTUBE_HEADERS = {
  'Content-Type':  'application/json',
  'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Accept':        '*/*',
  'Origin':        'https://www.youtube.com',
  'Referer':       'https://www.youtube.com/',
  'X-YouTube-Client-Name':    '1',
  'X-YouTube-Client-Version': INNERTUBE_CLIENT.clientVersion,
};

/**
 * Generic InnerTube POST request.
 * endpoint: e.g. 'browse', 'search'
 * body:     additional fields merged into context wrapper
 */
function innerTubePost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      context: { client: INNERTUBE_CLIENT },
      ...body,
    });

    const opts = {
      hostname: 'www.youtube.com',
      path:     `/youtubei/v1/${endpoint}?prettyPrint=false`,
      method:   'POST',
      headers:  { ...INNERTUBE_HEADERS, 'Content-Length': Buffer.byteLength(payload) },
    };

    const req = https.request(opts, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; if (raw.length > 8_000_000) { req.destroy(); reject(new Error('Response too large')); } });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('InnerTube JSON parse failed: ' + e.message)); }
      });
    });

    req.setTimeout(12_000, () => { req.destroy(); reject(new Error('InnerTube timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Extract tracks from a playlist browse response.
 * Handles both initial load and continuation pages.
 */
function extractPlaylistTracks(data) {
  const tracks = [];

  // Try initial browse structure
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  if (tabs) {
    for (const tab of tabs) {
      const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents;
      if (!sections) continue;
      for (const sec of sections) {
        const items = sec?.itemSectionRenderer?.contents;
        if (!items) continue;
        for (const item of items) {
          const videos = item?.playlistVideoListRenderer?.contents;
          if (!videos) continue;
          for (const v of videos) {
            const vr = v.playlistVideoRenderer;
            if (!vr?.videoId) continue;
            tracks.push({
              id:     vr.videoId,
              title:  vr.title?.runs?.[0]?.text || 'Unknown',
              artist: vr.shortBylineText?.runs?.[0]?.text || '',
            });
          }
          // Return continuation token if present
          const contItem = videos.find(v => v.continuationItemRenderer);
          const contToken = contItem?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
          return { tracks, continuationToken: contToken };
        }
      }
    }
  }

  // Try continuation response structure
  const onResponseReceived = data?.onResponseReceivedActions;
  if (onResponseReceived) {
    for (const action of onResponseReceived) {
      const videos = action?.appendContinuationItemsAction?.continuationItems;
      if (!videos) continue;
      for (const v of videos) {
        const vr = v.playlistVideoRenderer;
        if (!vr?.videoId) continue;
        tracks.push({
          id:     vr.videoId,
          title:  vr.title?.runs?.[0]?.text || 'Unknown',
          artist: vr.shortBylineText?.runs?.[0]?.text || '',
        });
      }
      const contItem = videos.find(v => v.continuationItemRenderer);
      const contToken = contItem?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null;
      return { tracks, continuationToken: contToken };
    }
  }

  return { tracks, continuationToken: null };
}

/**
 * Extract video results from a search response.
 */
function extractSearchResults(data) {
  const results = [];
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  if (!sections) return results;
  for (const sec of sections) {
    const items = sec?.itemSectionRenderer?.contents;
    if (!items) continue;
    for (const item of items) {
      const vr = item.videoRenderer;
      if (!vr?.videoId) continue;
      results.push({
        id:      vr.videoId,
        title:   vr.title?.runs?.[0]?.text || '',
        channel: vr.ownerText?.runs?.[0]?.text || vr.longBylineText?.runs?.[0]?.text || '',
        thumb:   vr.thumbnail?.thumbnails?.[0]?.url || '',
      });
      if (results.length >= 8) break;
    }
    if (results.length) break;
  }
  return results;
}

// Path for JSON persistence
const DATA_PATH = path.join(__dirname, 'freq_data.json');

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(__dirname));

// ─── In-Memory Data Store ─────────────────────────────────────────────────────
// accounts:  Map<username_lower, { username, displayName, salt, hash, createdAt }>
// playlists: Map<username_lower, [{ name, items, savedAt }]>
// sessions:  Map<token, { username, expiresAt }>

const store = {
  accounts:  new Map(),
  playlists: new Map(),
  sessions:  new Map(),
};

// ─── Persistence ─────────────────────────────────────────────────────────────
function persistStore() {
  try {
    const data = {
      accounts:  Array.from(store.accounts.entries()),
      playlists: Array.from(store.playlists.entries()),
      sessions:  Array.from(store.sessions.entries()),
    };
    fs.writeFileSync(DATA_PATH, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('[persist] Write failed:', err.message);
  }
}

function loadStore() {
  if (!fs.existsSync(DATA_PATH)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    if (data.accounts)  store.accounts  = new Map(data.accounts);
    if (data.playlists) store.playlists = new Map(data.playlists);
    if (data.sessions)  store.sessions  = new Map(data.sessions);
    // Prune expired sessions on load
    const now = Date.now();
    for (const [tok, sess] of store.sessions) {
      if (sess.expiresAt < now) store.sessions.delete(tok);
    }
    console.log(`[store] Loaded: ${store.accounts.size} accounts, ${store.sessions.size} active sessions`);
  } catch (err) {
    console.error('[store] Load failed:', err.message);
  }
}

// Debounced persist — avoid hammering disk
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistStore, 800);
}

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

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

function resolveToken(token) {
  if (!token) return null;
  const sess = store.sessions.get(token);
  if (!sess) return null;
  if (sess.expiresAt < Date.now()) {
    store.sessions.delete(token);
    schedulePersist();
    return null;
  }
  return sess;
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

function resolveYouTube(url) {
  const u = new URL(url);
  const browsePath = u.pathname.match(/^\/browse\/(VL[A-Za-z0-9_-]+)/);
  if (browsePath) {
    const listId = browsePath[1].replace(/^VL/, '');
    return {
      type: 'playlist',
      embedUrl: `https://www.youtube.com/embed/videoseries?list=${listId}&autoplay=1&controls=1`,
      id: listId,
      expandable: true,   // v4.1: signal client to expand into individual tracks
    };
  }
  const listId  = u.searchParams.get('list');
  const videoId = u.searchParams.get('v') ||
    (u.hostname === 'youtu.be' ? u.pathname.replace(/^\//, '').split('?')[0] : null);
  if (listId) return {
    type: 'playlist',
    embedUrl: `https://www.youtube.com/embed/videoseries?list=${listId}&autoplay=1&controls=1`,
    id: listId,
    expandable: true,   // v4.1: signal client to expand
  };
  if (videoId && videoId.length >= 11) return {
    type: 'video',
    embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&enablejsapi=1`,
    id: videoId,
  };
  return null;
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
  const playlistMatch = u.pathname.match(/^\/([a-z]{2})\/playlist\/(?:[^/]*\/)?(pl\.[A-Za-z0-9]+)/);
  if (playlistMatch) {
    const [, country, id] = playlistMatch;
    return { type:'playlist', embedUrl:`https://embed.music.apple.com/${country}/playlist/${id}`, id };
  }
  const albumMatch = u.pathname.match(/^\/([a-z]{2})\/(?:album|song)\/(?:[^/]*\/)?([\d]+)/);
  if (!albumMatch) return null;
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

/**
 * Deezer — v4.0 NEW
 * Deezer supports public embeds via https://widget.deezer.com/widget/dark/<type>/<id>
 * Supports: track, album, playlist, artist, radio
 */
function resolveDeezer(url) {
  const u = new URL(url);
  // Paths: /us/track/123, /track/123, /playlist/123, /album/123, /artist/123
  const match = u.pathname.match(/(?:\/[a-z]{2})?\/?(track|playlist|album|artist|radio)\/([0-9]+)/i);
  if (!match) return null;
  const [, rawType, id] = match;
  const type = rawType.toLowerCase();
  // Deezer widget uses plural for most but "track" stays singular
  const widgetType = type === 'track' ? 'track' : type + 's';
  return {
    type,
    embedUrl: `https://widget.deezer.com/widget/dark/${type}/${id}`,
    id,
  };
}

/**
 * Last.fm — v4.0 NEW
 * Last.fm has no embeddable player — we redirect with the branded page.
 * We extract artist/track/album/user info for a useful label.
 */
function resolveLastFm(url) {
  const u = new URL(url);
  // Patterns:
  //   /music/<artist>/_/<track>
  //   /music/<artist>/<album>
  //   /user/<username>
  //   /tag/<tag>
  const pathname = u.pathname;

  let type = 'link';
  let id   = url;

  const musicMatch = pathname.match(/^\/music\/([^/]+)(?:\/_\/([^/]+)|\/([^/]+))?/);
  const userMatch  = pathname.match(/^\/user\/([^/]+)/);
  const tagMatch   = pathname.match(/^\/tag\/([^/]+)/);

  if (musicMatch) {
    const [, artist, track, album] = musicMatch;
    if (track)  { type = 'track';  id = decodeURIComponent(artist) + ' — ' + decodeURIComponent(track); }
    else if (album) { type = 'album'; id = decodeURIComponent(artist) + ' · ' + decodeURIComponent(album); }
    else            { type = 'artist'; id = decodeURIComponent(artist); }
  } else if (userMatch) {
    type = 'profile';
    id   = decodeURIComponent(userMatch[1]);
  } else if (tagMatch) {
    type = 'tag';
    id   = decodeURIComponent(tagMatch[1]);
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
  amazon: { name:'Amazon Music',  color:'#00A8E1', bgColor:'#0f1923', emoji:'◈' },
  qobuz:  { name:'Qobuz',         color:'#05b8cc', bgColor:'#050f14', emoji:'◉' },
  lastfm: { name:'Last.fm',       color:'#d51007', bgColor:'#0e0505', emoji:'⊕' },
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
app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    version:  '4.1',
    uptime:   Math.floor(process.uptime()),
    platform: process.platform,
    accounts: store.accounts.size,
    sessions: store.sessions.size,
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
    return res.status(400).json({ error: 'Unsupported platform. Paste a URL from YouTube, YT Music, Spotify, Tidal, SoundCloud, Apple Music, Amazon Music, Qobuz, Deezer, or Last.fm.' });

  try {
    const info = RESOLVERS[platform](trimmed);
    if (!info) return res.status(400).json({ error: `Could not extract a playable ID from this ${platform} URL.` });
    return res.json({ platform, originalUrl: trimmed, ...info });
  } catch (err) {
    console.error(`[resolve] ${platform}:`, err.message);
    return res.status(400).json({ error: 'Could not parse this URL.' });
  }
});

// ─── POST /api/import (batch) ─────────────────────────────────────────────────
app.post('/api/import', rateLimit, (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || !urls.length)
    return res.status(400).json({ error: 'Request body must include a "urls" array.' });
  if (urls.length > 100)
    return res.status(400).json({ error: 'Maximum 100 URLs per import.' });

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

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/auth/signup ────────────────────────────────────────────────────
app.post('/api/auth/signup', rateLimit, async (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const key = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!key || key.length < 2)
    return res.status(400).json({ error: 'Username must be 2+ alphanumeric chars or underscores.' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  if (store.accounts.has(key))
    return res.status(409).json({ error: 'Username already taken.' });

  try {
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    store.accounts.set(key, { username: key, displayName: (displayName || '').trim() || key, salt, hash, createdAt: Date.now() });
    store.playlists.set(key, []);

    const token = generateToken();
    store.sessions.set(token, { username: key, expiresAt: Date.now() + TOKEN_TTL });
    schedulePersist();

    return res.status(201).json({ token, username: key, displayName: store.accounts.get(key).displayName });
  } catch (err) {
    console.error('[signup]', err);
    return res.status(500).json({ error: 'Server error during signup.' });
  }
});

// ─── POST /api/auth/signin ────────────────────────────────────────────────────
app.post('/api/auth/signin', rateLimit, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const key  = username.trim().toLowerCase();
  const acct = store.accounts.get(key);
  if (!acct)
    return res.status(401).json({ error: 'No account found with that username.' });

  try {
    const hash = await hashPassword(password, acct.salt);
    if (hash !== acct.hash)
      return res.status(401).json({ error: 'Incorrect password.' });

    const token = generateToken();
    store.sessions.set(token, { username: key, expiresAt: Date.now() + TOKEN_TTL });
    schedulePersist();

    return res.json({
      token,
      username:    key,
      displayName: acct.displayName,
      playlists:   store.playlists.get(key) || [],
    });
  } catch (err) {
    console.error('[signin]', err);
    return res.status(500).json({ error: 'Server error during sign in.' });
  }
});

// ─── POST /api/auth/token-refresh ─────────────────────────────────────────────
app.post('/api/auth/token-refresh', (req, res) => {
  const { token } = req.body;
  const sess = resolveToken(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });

  sess.expiresAt = Date.now() + TOKEN_TTL;
  store.sessions.set(token, sess);
  schedulePersist();
  return res.json({ ok: true, expiresAt: sess.expiresAt });
});

// ─── POST /api/auth/sync (push playlists) ─────────────────────────────────────
app.post('/api/auth/sync', (req, res) => {
  const { token, playlists } = req.body;
  const sess = resolveToken(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  if (!Array.isArray(playlists)) return res.status(400).json({ error: '"playlists" must be an array.' });
  if (JSON.stringify(playlists).length > 2_000_000)
    return res.status(413).json({ error: 'Playlist data exceeds 2 MB limit.' });

  store.playlists.set(sess.username, playlists);
  schedulePersist();
  return res.json({ ok: true, synced: playlists.length, syncedAt: Date.now() });
});

// ─── GET /api/auth/pull ───────────────────────────────────────────────────────
app.get('/api/auth/pull', (req, res) => {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = resolveToken(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });

  const acct = store.accounts.get(sess.username);
  return res.json({
    username:    sess.username,
    displayName: acct ? acct.displayName : sess.username,
    playlists:   store.playlists.get(sess.username) || [],
    pulledAt:    Date.now(),
  });
});

// ─── DELETE /api/auth/account ─────────────────────────────────────────────────
app.delete('/api/auth/account', (req, res) => {
  const token = req.body.token || (req.headers.authorization || '').replace('Bearer ', '');
  const sess  = resolveToken(token);
  if (!sess) return res.status(401).json({ error: 'Invalid or expired token.' });

  const username = sess.username;
  store.accounts.delete(username);
  store.playlists.delete(username);
  // Purge all sessions for this user
  for (const [tok, s] of store.sessions) {
    if (s.username === username) store.sessions.delete(tok);
  }
  schedulePersist();
  return res.json({ ok: true, deleted: username });
});

// ─── GET /api/yt/playlist ─────────────────────────────────────────────────────
// Expands a YouTube playlist/album into individual track objects.
// Query params:
//   listId     (required)  YouTube playlist ID, e.g. PLxxxxxx or OLAK5uy_xxx (album mix)
//   pageToken  (optional)  Continuation token for page 2+
//   maxPages   (optional)  Maximum continuation pages to follow (default 3, max 10)
//
// Returns: { tracks: [{id, title, artist}], continuationToken, total, listId }
app.get('/api/yt/playlist', rateLimit, async (req, res) => {
  const { listId, pageToken, maxPages } = req.query;
  if (!listId || typeof listId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(listId))
    return res.status(400).json({ error: 'listId is required and must be a valid YouTube playlist ID.' });

  const maxP = Math.min(parseInt(maxPages) || 3, 10);

  try {
    let allTracks = [];
    let contToken = pageToken || null;
    let isFirst   = true;

    for (let page = 0; page < (pageToken ? 1 : maxP); page++) {
      let data;
      if (isFirst && !pageToken) {
        // Initial browse request
        data = await innerTubePost('browse', { browseId: `VL${listId}` });
        isFirst = false;
      } else {
        // Continuation request
        if (!contToken) break;
        data = await innerTubePost('browse', { continuation: contToken });
      }

      const { tracks, continuationToken } = extractPlaylistTracks(data);

      if (!tracks.length && page === 0) {
        // InnerTube returned nothing — possibly a private/deleted list
        return res.status(404).json({ error: 'Playlist not found or is private.' });
      }

      allTracks.push(...tracks);
      contToken = continuationToken;

      if (!contToken) break; // no more pages
    }

    return res.json({
      listId,
      tracks:            allTracks,
      total:             allTracks.length,
      continuationToken: contToken || null,
      hasMore:           !!contToken,
    });
  } catch (err) {
    console.error('[yt/playlist]', err.message);
    return res.status(502).json({ error: 'Failed to fetch playlist from YouTube: ' + err.message });
  }
});

// ─── GET /api/yt/search ───────────────────────────────────────────────────────
// Searches YouTube for videos matching a query.
// Used as a fallback when a video is blocked/unavailable.
// Query params:
//   q      (required)  Search query string
//   limit  (optional)  Max results to return (default 5, max 8)
//
// Returns: { results: [{id, title, channel, thumb}], query }
app.get('/api/yt/search', rateLimit, async (req, res) => {
  const { q, limit } = req.query;
  if (!q || typeof q !== 'string' || !q.trim())
    return res.status(400).json({ error: 'Query parameter "q" is required.' });

  const maxResults = Math.min(parseInt(limit) || 5, 8);
  const query      = q.trim().slice(0, 200); // cap query length

  try {
    const data    = await innerTubePost('search', { query, params: 'EgIQAQ%3D%3D' }); // EgIQAQ== = videos only filter
    const results = extractSearchResults(data).slice(0, maxResults);

    if (!results.length) {
      // Fallback: retry without videos-only filter
      const data2 = await innerTubePost('search', { query });
      const fallback = extractSearchResults(data2).slice(0, maxResults);
      return res.json({ results: fallback, query, fallback: true });
    }

    return res.json({ results, query });
  } catch (err) {
    console.error('[yt/search]', err.message);
    return res.status(502).json({ error: 'YouTube search failed: ' + err.message });
  }
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
loadStore();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵  FREQ v4.1 "Sigma+" is running`);
  console.log(`    Local:    http://localhost:${PORT}`);
  console.log(`    Health:   http://localhost:${PORT}/health`);
  console.log(`    YT API:   http://localhost:${PORT}/api/yt/playlist?listId=PLxxx`);
  console.log(`    Search:   http://localhost:${PORT}/api/yt/search?q=track+name`);
  console.log(`    Data:     ${DATA_PATH}`);
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

// Graceful shutdown — flush to disk
process.on('SIGINT',  () => { persistStore(); process.exit(0); });
process.on('SIGTERM', () => { persistStore(); process.exit(0); });
