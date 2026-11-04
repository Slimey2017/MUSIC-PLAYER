# Comfort Mode and YouTube playlist reliability

## What changes

- The Music-to-YouTube hostname conversion is normal and preserves the playlist ID. The exact reported playlist, including its trailing hyphen, is covered by regression tests.
- Playing a YouTube playlist first resolves it through the existing `/api/yt/tracks` route and replaces that queue entry with individual public/importable tracks. The original Music playlist URL remains attached as `sourcePlaylistUrl`. A failed import leaves the queue unchanged and offers retry, the source playlist player, or opening YouTube.
- Every YouTube playback URL is rebuilt with the browser's actual origin, JavaScript API support and inline playback. The iframe explicitly sends an origin referrer. This fixes the client-facing hard-coded-origin path, including already-saved queue entries; the legacy server URL builder is not changed.
- Actual player errors distinguish missing/private videos, owner-disabled embedding and error 153. Slow loads, autoplay policies and oEmbed request failures are not described as proof of an embedding restriction. No restriction bypass or audio extraction is added.
- Player messages must come from the active frame and an exact trusted YouTube origin. Ended events are deduplicated; delayed advances are cancelled on track changes.
- Comfort Mode is optional and saved on this browser. It provides Home/Search/Your Library, artwork shelves, listening tips, a More menu and persistent controls that reuse the existing media elements. Classic Mode and the selected theme remain available.
- Queue removals can be undone for ten seconds. Local blob URLs are retained through that window; queue locking is respected. Undo does not unexpectedly restart playback.

## Integration

`index.html` and `server.js` stay intact. Their already-loaded `verification_frontend.js` path is a compatibility bootstrap for independent browser assets. The previous artist-verification implementation is preserved **byte-for-byte** in `verification-ui.js`; the bootstrap queues early verification calls until it loads. No verification endpoints, authentication or permissions are changed.

Ship these browser files together and invalidate stale static caches: `verification_frontend.js`, `verification-ui.js`, `freq-comfort.js`, `freq-comfort.css`. No npm dependency changes, server environment changes, Supabase migrations or data edits are required. The existing YouTube API configuration remains applicable; a server-side `YOUTUBE_API_KEY` improves playlist resolution but does not grant private-playlist access.

## Checks and limitations

Run `node --test tests/comfort-playback.test.js` for the ten new tests. The full existing suite can be run with `node --test tests/*.test.js`.

The unchanged baseline has three failing test entries: the `--font-xs:12px` design-token assertion in the static smoke suite, the AcoustID review-decision assertion, and the complete WAV analysis decision assertion. These unrelated tests are not weakened or changed here.

Real browser autoplay, geographic restrictions, referrer-blocking extensions, private playlists, and the reported playlist's current availability still require a deployed preview/manual check. The live HTML fetch of the reported playlist was blocked by YouTube's automated-request protection in the development environment; its contents/playability are not claimed as verified. Local browser automation could not be completed in this environment.

Before merging, test the supplied playlist on the actual FREQ origin and check Home/More/player/queue behavior at desktop and mobile widths. No merge, deployment or Supabase mutation is part of this change.
