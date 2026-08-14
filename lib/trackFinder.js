'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ALLOWED_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
]);
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 4;

class TrackFinderError extends Error {
  constructor(code, message, { status = 502, retryable = false, debug = null } = {}) {
    super(message);
    this.name = 'TrackFinderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.debug = debug;
  }
}

function isPrivateIp(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    return a === '::1' || a === '::' || a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('::ffff:127.') || a.startsWith('::ffff:10.') || a.startsWith('::ffff:192.168.');
  }
  return true;
}

function normalizeYouTubeUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); }
  catch { throw new TrackFinderError('INVALID_URL', 'Enter a valid YouTube or YouTube Music URL.', { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TrackFinderError('INVALID_URL', 'Only http:// and https:// URLs are allowed.', { status: 400 });
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!ALLOWED_HOSTS.has(host)) {
    throw new TrackFinderError('UNSUPPORTED_SOURCE', "FREQ doesn't support this source in Track Finder yet.", { status: 400 });
  }

  // Expand youtu.be into a normal watch URL so parsing/logging behaves consistently.
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (!id) throw new TrackFinderError('INVALID_URL', 'This YouTube short link is missing a video ID.', { status: 400 });
    const next = new URL('https://www.youtube.com/watch');
    next.searchParams.set('v', id);
    if (url.searchParams.get('list')) next.searchParams.set('list', url.searchParams.get('list'));
    url = next;
  }

  if (url.hostname === 'music.youtube.com') url.hostname = 'www.youtube.com';
  if (url.protocol === 'http:') url.protocol = 'https:';

  // Strip tracking/noise but preserve identifiers needed to locate the page.
  const keep = new Set(['v', 'list', 'index', 'start_radio']);
  [...url.searchParams.keys()].forEach(key => { if (!keep.has(key)) url.searchParams.delete(key); });
  url.hash = '';
  return url;
}

function safeLogUrl(raw) {
  try {
    const u = new URL(raw);
    const out = new URL(`${u.protocol}//${u.host}${u.pathname}`);
    for (const key of ['v', 'list']) {
      const value = u.searchParams.get(key);
      if (value) out.searchParams.set(key, value.slice(0, 80));
    }
    return out.toString();
  } catch { return '[invalid url]'; }
}

async function assertPublicAllowedHost(url, lookup = dns.lookup) {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!ALLOWED_HOSTS.has(host)) {
    throw new TrackFinderError('SOURCE_BLOCKED', 'The source redirected somewhere FREQ is not allowed to fetch.', { status: 502 });
  }
  let records;
  try { records = await lookup(host, { all: true, verbatim: true }); }
  catch (err) { throw new TrackFinderError('FETCH_FAILED', 'The source hostname could not be resolved.', { retryable: true, debug: err.message }); }
  if (!records?.length || records.some(r => isPrivateIp(r.address))) {
    throw new TrackFinderError('SOURCE_BLOCKED', 'The source resolved to a blocked network address.', { status: 403 });
  }
}

function responseErrorForStatus(status) {
  if (status === 401) return new TrackFinderError('AUTH_REQUIRED', 'This playlist requires authentication.', { status: 401 });
  if (status === 403) return new TrackFinderError('PRIVATE_PLAYLIST', 'This playlist is private, restricted, or requires login.', { status: 403 });
  if (status === 404) return new TrackFinderError('HTTP_ERROR', 'Playlist or page not found.', { status: 404 });
  if (status === 429) return new TrackFinderError('RATE_LIMITED', 'The source is temporarily limiting requests. Try again later.', { status: 429, retryable: true });
  if (status >= 500) return new TrackFinderError('HTTP_ERROR', 'The source service is currently unavailable.', { status: 502, retryable: true, debug: `upstream ${status}` });
  return new TrackFinderError('HTTP_ERROR', `The source returned HTTP ${status}.`, { status: 502, retryable: status >= 400 });
}

async function fetchSourcePage(rawUrl, {
  fetchImpl = global.fetch,
  lookup = dns.lookup,
  timeoutMs = 10_000,
  maxBytes = MAX_RESPONSE_BYTES,
  maxRedirects = MAX_REDIRECTS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TrackFinderError('FETCH_FAILED', 'HTTP fetch is unavailable.', { retryable: true });
  let current = normalizeYouTubeUrl(rawUrl);
  let redirects = 0;

  while (true) {
    await assertPublicAllowedHost(current, lookup);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(current, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': YT_UA,
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          // Consent preference only; never forward user cookies/authentication.
          'Cookie': 'CONSENT=YES+; SOCS=CAESEwgDEgk0OTA3NzkzMjQaAmVuIAEaBgiAo_CmBg==',
        },
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw new TrackFinderError('FETCH_FAILED', 'The source took too long to respond.', { status: 504, retryable: true, debug: 'timeout' });
      throw new TrackFinderError('FETCH_FAILED', 'The source page could not be reached.', { retryable: true, debug: err?.message });
    } finally { clearTimeout(timer); }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new TrackFinderError('HTTP_ERROR', 'The source returned an invalid redirect.', { status: 502 });
      if (++redirects > maxRedirects) throw new TrackFinderError('HTTP_ERROR', 'Too many source redirects.', { status: 502 });
      current = normalizeYouTubeUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) throw responseErrorForStatus(response.status);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new TrackFinderError('PARSER_FAILED', 'FREQ reached the source, but it did not return a readable playlist page.', { status: 502, debug: `content-type ${contentType || '(none)'}` });
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new TrackFinderError('SOURCE_BLOCKED', 'The source response is too large to inspect safely.', { status: 413 });
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new TrackFinderError('SOURCE_BLOCKED', 'The source response is too large to inspect safely.', { status: 413 });
    }
    return {
      ok: true,
      status: response.status,
      contentType,
      html: text,
      finalUrl: current.toString(),
      redirects,
      size: Buffer.byteLength(text, 'utf8'),
    };
  }
}

function extractBalancedJson(html, patterns) {
  for (const pattern of patterns) {
    const match = html.search(pattern);
    if (match < 0) continue;
    const start = html.indexOf('{', match);
    if (start < 0) continue;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\' && inString) { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

function extractYtInitialData(html) {
  return extractBalancedJson(html, [
    /var\s+ytInitialData\s*=\s*\{/,
    /window\[\s*["']ytInitialData["']\s*\]\s*=\s*\{/,
    /ytInitialData\s*=\s*\{/,
  ]);
}

function extractYtInitialPlayerResponse(html) {
  return extractBalancedJson(html, [
    /var\s+ytInitialPlayerResponse\s*=\s*\{/,
    /ytInitialPlayerResponse\s*=\s*\{/,
  ]);
}

function textValue(node) {
  return node?.simpleText || (Array.isArray(node?.runs) ? node.runs.map(r => r?.text || '').join('') : '') || '';
}

function extractTracksFromYtData(data, diagnostics = null) {
  const tracks = [];
  const seen = new Set();
  const counts = diagnostics || {};
  const add = (rendererType, r, id, title, duration, thumbs) => {
    counts[rendererType] = (counts[rendererType] || 0) + 1;
    if (!id || seen.has(id)) return;
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle || cleanTitle.toLowerCase() === 'unknown') return;
    seen.add(id);
    const arr = Array.isArray(thumbs) ? thumbs : [];
    tracks.push({
      id,
      title: cleanTitle,
      artist: null,
      album: null,
      duration: duration || null,
      thumb: arr[arr.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  };

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (obj.playlistVideoRenderer) {
      const r = obj.playlistVideoRenderer;
      add('playlistVideoRenderer', r, r.videoId, textValue(r.title), textValue(r.lengthText) || null, r.thumbnail?.thumbnails);
    }
    if (obj.videoRenderer) {
      const r = obj.videoRenderer;
      add('videoRenderer', r, r.videoId, textValue(r.title), textValue(r.lengthText) || null, r.thumbnail?.thumbnails);
    }
    if (obj.gridVideoRenderer) {
      const r = obj.gridVideoRenderer;
      add('gridVideoRenderer', r, r.videoId, textValue(r.title), textValue(r.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text) || null, r.thumbnail?.thumbnails);
    }
    if (obj.reelItemRenderer || obj.reelsItemRenderer) {
      const r = obj.reelItemRenderer || obj.reelsItemRenderer;
      add('reelItemRenderer', r, r.videoId, textValue(r.headline) || r.accessibility?.accessibilityData?.label, null, r.thumbnail?.thumbnails);
    }
    if (obj.musicVideoRenderer) {
      const r = obj.musicVideoRenderer;
      add('musicVideoRenderer', r, r.videoId, textValue(r.title), textValue(r.lengthText) || null, r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || r.thumbnail?.thumbnails);
    }
    if (obj.musicTwoRowItemRenderer) {
      const r = obj.musicTwoRowItemRenderer;
      const ep = r.navigationEndpoint?.watchEndpoint || r.navigationEndpoint?.watchPlaylistEndpoint;
      add('musicTwoRowItemRenderer', r, ep?.videoId, textValue(r.title), null, r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || r.thumbnail?.thumbnails);
    }
    if (obj.musicResponsiveListItemRenderer) {
      const r = obj.musicResponsiveListItemRenderer;
      const id = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
        || r.overlay?.musicItemThumbnailOverlayRenderer?.startMusicPlayCommand?.watchEndpoint?.videoId
        || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
      const title = textValue(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
      const duration = textValue(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)
        || textValue(r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text) || null;
      add('musicResponsiveListItemRenderer', r, id, title, duration, r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || r.thumbnail?.thumbnails);
    }
    Object.values(obj).forEach(v => { if (v && typeof v === 'object') walk(v); });
  }
  walk(data);
  return tracks;
}

function extractPlaylistTitle(data) {
  try {
    const candidates = [
      data?.header?.playlistHeaderRenderer?.title,
      data?.header?.pageHeaderRenderer?.pageTitle,
      data?.sidebar?.playlistSidebarRenderer?.items?.[0]?.playlistSidebarPrimaryInfoRenderer?.title,
    ];
    for (const c of candidates) { const t = textValue(c); if (t) return t; }
    const mf = data?.microformat?.microformatDataRenderer;
    if (mf?.title) return mf.title;
  } catch {}
  return null;
}

function extractJsonLdTracks(html, diagnostics = null) {
  const tracks = [];
  const seen = new Set();
  const rx = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = rx.exec(html))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      const walk = obj => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) return obj.forEach(walk);
        const type = obj['@type'];
        if ((type === 'VideoObject' || type === 'MusicRecording') && obj.name) {
          const url = obj.url || obj.contentUrl || obj.embedUrl || '';
          const idMatch = String(url).match(/[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|embed\/([\w-]{11})/);
          const id = idMatch && (idMatch[1] || idMatch[2] || idMatch[3]);
          if (id && !seen.has(id)) {
            seen.add(id);
            tracks.push({ id, title: String(obj.name), artist: obj.byArtist?.name || null, album: obj.inAlbum?.name || null, duration: null, thumb: Array.isArray(obj.thumbnailUrl) ? obj.thumbnailUrl[0] : (obj.thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`) });
          }
        }
        Object.values(obj).forEach(walk);
      };
      roots.forEach(walk);
    } catch { if (diagnostics) diagnostics.malformedJsonLd = (diagnostics.malformedJsonLd || 0) + 1; }
  }
  if (diagnostics) diagnostics.jsonLdTracks = tracks.length;
  return tracks;
}

function pageTextSignals(html) {
  const lower = html.toLowerCase();
  return {
    private: /playlist is private|private playlist|this video is private/.test(lower),
    auth: /sign in to confirm|sign in to continue|requires sign-in|login required|age-restricted/.test(lower),
    blocked: /unusual traffic|automated queries|captcha|sorry, something went wrong|consent\.youtube/.test(lower),
    unavailable: /playlist does not exist|playlist not found|video unavailable/.test(lower),
    empty: /playlist has no videos|no videos in this playlist|this playlist is empty/.test(lower),
  };
}

function hasPlaylistStructure(data) {
  let found = false;
  (function walk(obj) {
    if (found || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) return obj.forEach(walk);
    if (obj.playlistHeaderRenderer || obj.playlistVideoListRenderer || obj.playlistVideoRenderer || obj.playlistSidebarRenderer) { found = true; return; }
    Object.values(obj).forEach(walk);
  })(data);
  return found;
}

function parseYouTubePage(html, sourceUrl) {
  if (!html || html.length < 500) throw new TrackFinderError('PARSER_FAILED', 'FREQ reached the source, but the response was too small to contain track data.', { status: 502 });
  const signals = pageTextSignals(html);
  if (signals.private) throw new TrackFinderError('PRIVATE_PLAYLIST', 'This playlist is private or restricted.', { status: 403 });
  if (signals.auth) throw new TrackFinderError('AUTH_REQUIRED', 'This page requires YouTube authentication.', { status: 401 });
  if (signals.blocked) throw new TrackFinderError('SOURCE_BLOCKED', 'YouTube blocked this automated page request. Try again later.', { status: 503, retryable: true });
  if (signals.unavailable) throw new TrackFinderError('HTTP_ERROR', 'Playlist or page not found.', { status: 404 });

  const diagnostics = {};
  const initialData = extractYtInitialData(html);
  diagnostics.initialData = !!initialData;
  let tracks = initialData ? extractTracksFromYtData(initialData, diagnostics) : [];
  let parser = initialData ? 'ytInitialData-v3' : null;

  // Structured-data fallback catches valid server-rendered pages when YouTube
  // moves renderer locations/selectors but still emits VideoObject metadata.
  if (!tracks.length) {
    const ldTracks = extractJsonLdTracks(html, diagnostics);
    if (ldTracks.length) { tracks = ldTracks; parser = 'json-ld-v1'; }
  }

  // Single watch pages may expose only player response, not playlist renderers.
  if (!tracks.length) {
    const player = extractYtInitialPlayerResponse(html);
    diagnostics.playerResponse = !!player;
    const vd = player?.videoDetails;
    if (vd?.videoId && vd?.title) {
      tracks = [{ id: vd.videoId, title: vd.title, artist: vd.author || null, album: null, duration: vd.lengthSeconds ? String(vd.lengthSeconds) : null, thumb: vd.thumbnail?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${vd.videoId}/hqdefault.jpg` }];
      parser = 'ytInitialPlayerResponse-v1';
    }
  }

  const title = extractPlaylistTitle(initialData) || null;
  if (tracks.length) return { tracks, title, parser, diagnostics, empty: false };

  const url = normalizeYouTubeUrl(sourceUrl);
  const requestedPlaylist = !!url.searchParams.get('list') || url.pathname.startsWith('/playlist');
  const understoodPlaylist = initialData && hasPlaylistStructure(initialData);
  if (signals.empty || (requestedPlaylist && understoodPlaylist && /"playlistVideoListRenderer"\s*:\s*\{[^}]*"contents"\s*:\s*\[\s*\]/.test(html))) {
    return { tracks: [], title, parser: parser || 'ytInitialData-v3', diagnostics, empty: true };
  }

  if (!initialData) {
    throw new TrackFinderError('PARSER_FAILED', "FREQ reached the page, but couldn't find YouTube's structured page data. The source page may have changed or be dynamically rendered.", { status: 502, debug: diagnostics });
  }
  throw new TrackFinderError('PARSER_FAILED', "FREQ reached the page, but couldn't read its tracks. The source page may have changed or the tracks may be loaded dynamically.", { status: 502, debug: diagnostics });
}

module.exports = {
  TrackFinderError,
  normalizeYouTubeUrl,
  safeLogUrl,
  fetchSourcePage,
  extractYtInitialData,
  extractTracksFromYtData,
  extractPlaylistTitle,
  parseYouTubePage,
  responseErrorForStatus,
  isPrivateIp,
};
