/**
 * FREQ — Universal Music Player
 * server.js  ·  v3.1
 *
 * © 2025 FREQ / Slimey2017. All rights reserved.
 *
 * POST /api/resolve        { url: string }
 * POST /api/import         { urls: string[] }  — batch resolve
 * GET  /health             — uptime check
 * GET  /redirect           — ?url=<encoded> served as real HTML page (Amazon/Qobuz fix)
 *
 * Supported platforms:
 *   YouTube · YT Music · Spotify · Tidal · SoundCloud · Apple Music
 *   Amazon Music · Qobuz
 *
 * v3.1 fixes:
 *   - Apple Music: playlist embed now uses /playlist/ path (not /album/)
 *   - Apple Music: pl.xxxxxxx curator playlist IDs now parsed correctly
 *   - Apple Music: broader regex covers song URLs and no-slug variants
 */

const express     = require('express');
const cors        = require('cors');
const path        = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── Rate limiting (manual, no extra dep) ────────────────────────────────────
const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const window = 60_000;
  const max    = 120;

  if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
  const hits = rateLimitMap.get(ip).filter(t => now - t < window);
  hits.push(now);
  rateLimitMap.set(ip, hits);

  if (hits.length > max) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
  }
  next();
}

// Clean map every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateLimitMap) {
    const fresh = hits.filter(t => now - t < 60_000);
    if (fresh.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, fresh);
  }
}, 300_000);

// ─── Platform Detection ───────────────────────────────────────────────────────
function detectPlatform(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^www\./, '');
    if (h === 'music.youtube.com')         return 'ytmusic';
    if (h === 'youtube.com' || h === 'youtu.be') return 'youtube';
    if (h === 'open.spotify.com')          return 'spotify';
    if (h === 'tidal.com')                 return 'tidal';
    if (h === 'soundcloud.com')            return 'soundcloud';
    if (h === 'music.apple.com')           return 'applemusic';
    if (h === 'music.amazon.com')          return 'amazon';   // FIX: strict match, not amazon.com
    if (h === 'open.qobuz.com' || h === 'play.qobuz.com') return 'qobuz';
  } catch (_) { /* invalid URL */ }
  return null;
}

// ─── Embed URL Builders ───────────────────────────────────────────────────────

function resolveYouTube(url) {
  const u = new URL(url);

  // Browse-style YT Music playlists: music.youtube.com/browse/VL{listId}
  const browsePath = u.pathname.match(/^\/browse\/(VL[A-Za-z0-9_-]+)/);
  if (browsePath) {
    const listId = browsePath[1].replace(/^VL/, '');
    return {
      type:     'playlist',
      embedUrl: `https://www.youtube.com/embed/videoseries?list=${listId}&autoplay=1&controls=1`,
      id:       listId,
    };
  }

  const listId  = u.searchParams.get('list');
  const videoId = u.searchParams.get('v') ||
    (u.hostname === 'youtu.be' ? u.pathname.replace(/^\//, '').split('?')[0] : null);

  if (listId) {
    return {
      type:     'playlist',
      embedUrl: `https://www.youtube.com/embed/videoseries?list=${listId}&autoplay=1&controls=1`,
      id:       listId,
    };
  }
  if (videoId && videoId.length >= 11) {
    return {
      type:     'video',
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&enablejsapi=1`,
      id:       videoId,
    };
  }
  return null;
}

function resolveSpotify(url) {
  const match = new URL(url).pathname.match(
    /^\/(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/
  );
  if (!match) return null;
  const [, type, id] = match;
  return {
    type,
    embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`,
    id,
  };
}

function resolveTidal(url) {
  const match = new URL(url).pathname.match(/\/(playlist|album|track)\/([^/?]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return {
    type,
    embedUrl: `https://embed.tidal.com/${type}s/${id}`,
    id,
  };
}

function resolveSoundCloud(url) {
  // Support /likes/ and /sets/ as playlist, everything else as track
  const type = (url.includes('/sets/') || url.includes('/likes/')) ? 'playlist' : 'track';
  const params = new URLSearchParams({
    url,
    color:         '%23ff5500',
    auto_play:     'true',
    hide_related:  'false',
    show_comments: 'true',
    show_user:     'true',
    show_reposts:  'false',
    show_teaser:   'true',
    visual:        'true',
  });
  return {
    type,
    embedUrl: `https://w.soundcloud.com/player/?${params.toString()}`,
    id:       url,
  };
}

function resolveAppleMusic(url) {
  const u = new URL(url);

  // Playlist: /us/playlist/name/pl.xxxxxxxxxxxxxxxx  OR  /us/playlist/pl.xxx (no slug)
  const playlistMatch = u.pathname.match(/^\/([a-z]{2})\/playlist\/(?:[^/]*\/)?(pl\.[A-Za-z0-9]+)/);
  if (playlistMatch) {
    const [, country, id] = playlistMatch;
    return {
      type:     'playlist',
      embedUrl: `https://embed.music.apple.com/${country}/playlist/${id}`,
      id,
    };
  }

  // Album / Song: /us/album/name/123456789 or /us/song/name/123456789
  const albumMatch = u.pathname.match(/^\/([a-z]{2})\/(?:album|song)\/(?:[^/]*\/)?([\d]+)/);
  if (!albumMatch) return null;
  const [, country, id] = albumMatch;
  const trackId = u.searchParams.get('i');

  if (trackId) {
    return {
      type:     'track',
      embedUrl: `https://embed.music.apple.com/${country}/album/${id}?i=${trackId}`,
      id,
    };
  }
  return {
    type:     'album',
    embedUrl: `https://embed.music.apple.com/${country}/album/${id}`,
    id,
  };
}

/**
 * Amazon Music — FIX v3.0
 * Amazon has no public embed API. We now serve a real HTML redirect
 * page at GET /redirect?url=... instead of an inline data: URI.
 * The iframe sandbox allows same-origin (our own server) just fine.
 */
function resolveAmazon(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(playlists?|albums?|tracks?|artists?)\/([^/?]+)/i);
  let type = 'link';
  let id   = url;
  if (match) {
    type = match[1].replace(/s$/, '').toLowerCase();
    id   = match[2];
  }
  // Point embedUrl at our own /redirect route — no more data: URI
  const redirectUrl = `/redirect?url=${encodeURIComponent(url)}&platform=amazon`;
  return { type, embedUrl: redirectUrl, id };
}

/**
 * Qobuz — FIX v3.0
 * Qobuz's cross-origin embed requires an app_id which is not public.
 * Instead of a broken /embed/ path we serve the same /redirect route
 * (styled for Qobuz) so the user can open the track in their browser.
 */
function resolveQobuz(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(album|playlist|track)\/([^/?]+)/);
  if (!match) return null;
  const [, type, id] = match;
  const redirectUrl = `/redirect?url=${encodeURIComponent(url)}&platform=qobuz`;
  return { type, embedUrl: redirectUrl, id };
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
};

// ─── Redirect page (Amazon & Qobuz fix) ──────────────────────────────────────
const REDIRECT_BRANDS = {
  amazon: {
    name:    'Amazon Music',
    color:   '#00A8E1',
    bgColor: '#0f1923',
    emoji:   '◈',
  },
  qobuz: {
    name:    'Qobuz',
    color:   '#05b8cc',
    bgColor: '#050f14',
    emoji:   '◉',
  },
};

app.get('/redirect', (req, res) => {
  const targetUrl = req.query.url || '';
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
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: ${brand.bgColor};
      font-family: 'Space Mono', monospace;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      flex-direction: column;
      gap: 22px;
      color: #fff;
      padding: 32px;
    }
    .icon { font-size: 3rem; }
    .badge {
      background: ${brand.color};
      color: #000;
      font-family: 'Unbounded', sans-serif;
      font-weight: 900;
      font-size: 0.65rem;
      padding: 5px 14px;
      border-radius: 3px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    h2 {
      font-family: 'Unbounded', sans-serif;
      font-size: 1.1rem;
      letter-spacing: -0.01em;
      text-align: center;
    }
    p { color: #778; font-size: 0.75rem; text-align: center; line-height: 1.8; }
    a { color: ${brand.color}; text-decoration: none; font-weight: 700; }
    a:hover { text-decoration: underline; }
    .bar-wrap {
      width: 220px;
      height: 3px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: ${brand.color};
      border-radius: 2px;
      animation: fill 3s linear forwards;
    }
    @keyframes fill { from { width: 0%; } to { width: 100%; } }
    .note { font-size: 0.62rem; color: #444; margin-top: 8px; text-align: center; line-height: 1.9; }
  </style>
</head>
<body>
  <div class="icon">${brand.emoji}</div>
  <div class="badge">${brand.name}</div>
  <h2>Opening in ${brand.name}…</h2>
  <div class="bar-wrap"><div class="bar-fill"></div></div>
  <p>
    Redirecting automatically.<br>
    <a href="${decodeURIComponent(targetUrl)}" target="_blank">Click here</a> if it doesn't open.
  </p>
  <p class="note">
    ${brand.name} doesn't support embedded playback in third-party apps.<br>
    Your link will open in a new tab.
  </p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ─── API: GET /health ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    version:  '3.1',
    uptime:   Math.floor(process.uptime()),
    platform: process.platform,
  });
});

// ─── API: POST /api/resolve ───────────────────────────────────────────────────
app.post('/api/resolve', rateLimit, (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Request body must include a "url" string.' });
  }

  const trimmed  = url.trim();
  const platform = detectPlatform(trimmed);

  if (!platform) {
    return res.status(400).json({
      error: 'Unsupported platform. Paste a URL from YouTube, YT Music, Spotify, Tidal, SoundCloud, Apple Music, Amazon Music, or Qobuz.',
    });
  }

  const resolver = RESOLVERS[platform];
  let info;
  try {
    info = resolver(trimmed);
  } catch (err) {
    console.error(`[resolve] Error parsing ${platform} URL:`, err.message);
    return res.status(400).json({ error: 'Could not parse this URL.' });
  }

  if (!info) {
    return res.status(400).json({
      error: `Could not extract a playable ID from this ${platform} URL. Check that it's a valid playlist, album, or track link.`,
    });
  }

  return res.json({ platform, originalUrl: trimmed, ...info });
});

// ─── API: POST /api/import (batch resolve) ────────────────────────────────────
app.post('/api/import', rateLimit, async (req, res) => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Request body must include a "urls" array.' });
  }

  if (urls.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 URLs per import request.' });
  }

  const results = urls.map(rawUrl => {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return { error: 'Invalid URL', url: rawUrl };
    }
    const trimmed  = rawUrl.trim();
    const platform = detectPlatform(trimmed);
    if (!platform) return { error: 'Unsupported platform', url: trimmed };
    try {
      const info = RESOLVERS[platform](trimmed);
      if (!info) return { error: 'Could not parse URL', url: trimmed };
      return { platform, originalUrl: trimmed, ...info };
    } catch (err) {
      return { error: err.message, url: trimmed };
    }
  });

  const succeeded = results.filter(r => !r.error);
  const failed    = results.filter(r =>  r.error);

  return res.json({ succeeded, failed, total: results.length });
});

// ─── Catch-all: serve index.html ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵  FREQ v3.1 is running`);
  console.log(`    Local:  http://localhost:${PORT}`);
  console.log(`    Health: http://localhost:${PORT}/health`);
  console.log(`    © 2025 FREQ / Slimey2017. All rights reserved.\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is already in use.\n` +
      `   Run:  PORT=3001 node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
