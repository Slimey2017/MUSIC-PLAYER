/**
 * FREQ — Universal Music Player
 * server.js
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
/**
 * Returns a platform key based on the URL hostname.
 * YT Music must be checked BEFORE generic YouTube because
 * music.youtube.com also contains "youtube.com".
 */
function detectPlatform(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^www\./, '');
    if (h === 'music.youtube.com')          return 'ytmusic';
    if (h === 'youtube.com' || h === 'youtu.be') return 'youtube';
    if (h === 'open.spotify.com')           return 'spotify';
    if (h === 'tidal.com')                  return 'tidal';
    if (h === 'soundcloud.com')             return 'soundcloud';
    if (h === 'music.apple.com')            return 'applemusic';
  } catch (_) { /* invalid URL */ }
  return null;
}

// ─── Embed URL Builders ───────────────────────────────────────────────────────

/**
 * YouTube & YouTube Music
 *
 * Playlist: ?list=PLxxxx  →  /embed/videoseries?list=...
 * Single video: v=xxxx or youtu.be/xxxx  →  /embed/xxxx
 *
 * Both YT and YT Music use the same youtube.com embed URLs because
 * music.youtube.com does not expose its own embed endpoint.
 */
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

/**
 * Spotify
 *
 * open.spotify.com/{type}/{id}  →  open.spotify.com/embed/{type}/{id}
 * Types: playlist | album | track | artist | show | episode
 */
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

/**
 * Tidal
 *
 * tidal.com/browse/{type}/{id}  →  embed.tidal.com/{type}s/{id}
 * Note: Tidal embed slugs are the plural form (playlists, albums, tracks).
 */
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

/**
 * SoundCloud
 *
 * SoundCloud provides a universal iframe player that accepts the page URL
 * directly via the `url` query param. Works for tracks, sets (playlists),
 * and artist pages.
 *
 * visual=true  → waveform / artwork header
 * auto_play    → start on load
 */
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

  // Detect whether it's a set (playlist) or a track
  const type = url.includes('/sets/') ? 'playlist' : 'track';

  return {
    type,
    embedUrl: `https://w.soundcloud.com/player/?${params.toString()}`,
    id:       url, // SoundCloud doesn't expose a clean numeric ID in the URL
  };
}

/**
 * Apple Music
 *
 * music.apple.com/{country}/{type}/{name}/{id}
 * Embed: embed.music.apple.com/{country}/{type}/{id}
 *
 * Types: album, playlist, song (becomes "album" with i= query param for tracks)
 *
 * Examples:
 *   /us/album/folklore/1528112358
 *   /us/playlist/chill-vibes/pl.xxxxxxx
 *   /us/album/folklore/1528112358?i=1528112359  ← individual track
 */
function resolveAppleMusic(url) {
  const u = new URL(url);
  // country code is the first path segment, e.g. /us/
  const match = u.pathname.match(/^\/([a-z]{2})\/(album|playlist|song)\/[^/]*\/([^/?]+)/);
  if (!match) return null;

  const [, country, rawType, id] = match;
  const trackId = u.searchParams.get('i');

  let type, embedUrl;

  if (rawType === 'song' || trackId) {
    // Single track
    type = 'track';
    const trackParam = trackId ? `?i=${trackId}` : '';
    embedUrl = `https://embed.music.apple.com/${country}/album/${id}${trackParam}`;
  } else if (rawType === 'playlist') {
    type = 'playlist';
    embedUrl = `https://embed.music.apple.com/${country}/playlist/${id}`;
  } else {
    // album
    type = 'album';
    embedUrl = `https://embed.music.apple.com/${country}/album/${id}`;
  }

  return { type, embedUrl, id };
}

// ─── Resolver Map ─────────────────────────────────────────────────────────────
const RESOLVERS = {
  youtube:    resolveYouTube,
  ytmusic:    resolveYouTube,   // same embed domain
  spotify:    resolveSpotify,
  tidal:      resolveTidal,
  soundcloud: resolveSoundCloud,
  applemusic: resolveAppleMusic,
};

// ─── API: POST /api/resolve ───────────────────────────────────────────────────
app.post('/api/resolve', (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Request body must include a "url" string.' });
  }

  const trimmed = url.trim();

  // Detect platform
  const platform = detectPlatform(trimmed);
  if (!platform) {
    return res.status(400).json({
      error: 'Unsupported platform. Paste a URL from YouTube, YT Music, Spotify, Tidal, SoundCloud, or Apple Music.',
    });
  }

  // Run the appropriate resolver
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

  return res.json({
    platform,
    originalUrl: trimmed,
    ...info,           // type, embedUrl, id
  });
});

// ─── Catch-all: serve index.html for any unmatched route ─────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵  FREQ is running`);
  console.log(`    Local:  http://localhost:${PORT}\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is already in use.\n` +
      `   Close the app already using port ${PORT}, or run with a different port:\n` +
      `   PORT=3001 npm start\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});