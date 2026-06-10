/**
 * FREQ — Universal Music Player
 * server.js  ·  v2.0
 *
 * © 2025 FREQ / Slimey2017. All rights reserved.
 *
 * Serves the frontend and exposes one API endpoint:
 *   POST /api/resolve  { url: string }
 *   → { platform, type, embedUrl, id, originalUrl }
 *
 * Supported platforms:
 *   YouTube          youtube.com / youtu.be
 *   YouTube Music    music.youtube.com
 *   Spotify          open.spotify.com
 *   Tidal            tidal.com
 *   SoundCloud       soundcloud.com
 *   Apple Music      music.apple.com
 *   Amazon Music     music.amazon.com / amazon.com/music
 *   Qobuz            open.qobuz.com / play.qobuz.com
 *
 * Run:  node server.js
 * Then: http://localhost:3000
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));  // serves index.html from same folder as server.js

// ─── Platform Detection ───────────────────────────────────────────────────────
function detectPlatform(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^www\./, '');
    if (h === 'music.youtube.com')                        return 'ytmusic';
    if (h === 'youtube.com' || h === 'youtu.be')          return 'youtube';
    if (h === 'open.spotify.com')                         return 'spotify';
    if (h === 'tidal.com')                                return 'tidal';
    if (h === 'soundcloud.com')                           return 'soundcloud';
    if (h === 'music.apple.com')                          return 'applemusic';
    if (h === 'music.amazon.com' || h === 'amazon.com')   return 'amazon';
    if (h === 'open.qobuz.com' || h === 'play.qobuz.com') return 'qobuz';
  } catch (_) { /* invalid URL */ }
  return null;
}

// ─── Embed URL Builders ───────────────────────────────────────────────────────

function resolveYouTube(url) {
  const u = new URL(url);
  const listId  = u.searchParams.get('list');
  const videoId = u.searchParams.get('v') || u.pathname.replace(/^\//, '');

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
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1`,
      id:       videoId,
    };
  }
  return null;
}

function resolveSpotify(url) {
  const match = new URL(url).pathname.match(/^\/(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/);
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
  const type = url.includes('/sets/') ? 'playlist' : 'track';
  return {
    type,
    embedUrl: `https://w.soundcloud.com/player/?${params.toString()}`,
    id:       url,
  };
}

function resolveAppleMusic(url) {
  const u = new URL(url);
  const match = u.pathname.match(/^\/([a-z]{2})\/(album|playlist|song)\/[^/]*\/([^/?]+)/);
  if (!match) return null;
  const [, country, rawType, id] = match;
  const trackId = u.searchParams.get('i');
  let type, embedUrl;
  if (rawType === 'song' || trackId) {
    type = 'track';
    const trackParam = trackId ? `?i=${trackId}` : '';
    embedUrl = `https://embed.music.apple.com/${country}/album/${id}${trackParam}`;
  } else if (rawType === 'playlist') {
    type = 'playlist';
    embedUrl = `https://embed.music.apple.com/${country}/playlist/${id}`;
  } else {
    type = 'album';
    embedUrl = `https://embed.music.apple.com/${country}/album/${id}`;
  }
  return { type, embedUrl, id };
}

/**
 * Amazon Music
 *
 * Amazon Music does not have a public embed API.
 * We generate a redirect-style deep-link and serve a branded
 * "Open in Amazon Music" card in the embed area via a data URI page.
 *
 * URL patterns:
 *   music.amazon.com/playlists/{id}
 *   music.amazon.com/albums/{id}
 *   music.amazon.com/tracks/{id}
 *   music.amazon.com/artists/{id}
 */
function resolveAmazon(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(playlists?|albums?|tracks?|artists?)\/([^/?]+)/i);
  let type = 'link';
  let id   = url;
  if (match) {
    type = match[1].replace(/s$/, '').toLowerCase(); // remove trailing 's'
    id   = match[2];
  }
  // Build a simple redirect page as a data URI
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="2;url=${encodeURI(url)}">
  <title>Amazon Music</title>
  <style>
    body {
      margin: 0;
      background: #0f0f0f;
      font-family: 'Amazon Ember', Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      flex-direction: column;
      gap: 20px;
      color: #fff;
    }
    .badge {
      background: #00A8E1;
      color: #000;
      font-weight: 700;
      font-size: 0.8rem;
      padding: 4px 12px;
      border-radius: 4px;
      letter-spacing: 0.1em;
    }
    h2 { font-size: 1.4rem; margin: 0; }
    p  { color: #888; font-size: 0.8rem; }
    a  { color: #00A8E1; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <div class="badge">AMAZON MUSIC</div>
  <h2>Opening in Amazon Music…</h2>
  <p>Redirecting automatically. <a href="${url}" target="_blank">Click here</a> if it doesn't open.</p>
</body>
</html>`;
  const encoded = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  return { type, embedUrl: encoded, id };
}

/**
 * Qobuz
 *
 * Qobuz has a public embed player.
 * URL patterns:
 *   open.qobuz.com/album/{id}
 *   open.qobuz.com/playlist/{id}
 *   open.qobuz.com/track/{id}
 *   play.qobuz.com/... (same structure)
 *
 * Embed: https://play.qobuz.com/playlist/{id}
 * (Qobuz embeds work via play.qobuz.com subdomain with /embed/ prefix)
 */
function resolveQobuz(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(album|playlist|track)\/([^/?]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return {
    type,
    embedUrl: `https://play.qobuz.com/embed/${type}/${id}`,
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
};

// ─── API: POST /api/resolve ───────────────────────────────────────────────────
app.post('/api/resolve', (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Request body must include a "url" string.' });
  }

  const trimmed = url.trim();
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

// ─── Catch-all: serve index.html ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵  FREQ v2.0 is running`);
  console.log(`    Local:  http://localhost:${PORT}`);
  console.log(`    © 2025 FREQ / Slimey2017. All rights reserved.\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is already in use.\n` +
      `   Close the app already using port ${PORT}, or run:\n` +
      `   PORT=3001 node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
