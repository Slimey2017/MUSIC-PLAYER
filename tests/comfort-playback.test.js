'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ui = require('../freq-comfort');
const tf = require('../lib/trackFinder');
const root = path.join(__dirname, '..');
const failing = 'https://music.youtube.com/playlist?list=PL52qQckgC0OGCU38Rw44lqapUgo7-G_t-&si=G_7TnUjQ3u69xd5N';
const listId = 'PL52qQckgC0OGCU38Rw44lqapUgo7-G_t-';

test('reported Music playlist retains its full ID, including the trailing hyphen', () => {
  assert.deepEqual(ui.sourceOf(failing), { kind: 'playlist', id: listId });
  assert.equal(tf.extractPlaylistId(tf.normalizeYouTubeUrl(failing)), listId);
  assert.equal(tf.normalizeYouTubeUrl(failing).searchParams.has('si'), false);
});
test('Music-to-YouTube normalization changes host, not playlist identity', () => {
  assert.deepEqual(ui.sourceOf(tf.normalizeYouTubeUrl(failing).href), ui.sourceOf(failing));
});
test('both embed hosts use the actual page origin and JS API for playlists', () => {
  for (const privacy of [false, true]) {
    const url = new URL(ui.embedUrl(ui.sourceOf(failing), 'https://freq-preview.example/some/path', privacy));
    assert.equal(url.hostname, privacy ? 'www.youtube-nocookie.com' : 'www.youtube.com');
    assert.equal(url.pathname, '/embed/videoseries');
    assert.equal(url.searchParams.get('origin'), 'https://freq-preview.example');
    assert.equal(url.searchParams.get('enablejsapi'), '1');
    assert.equal(url.searchParams.get('list'), listId);
    assert.equal(url.searchParams.get('playsinline'), '1');
  }
});
test('single videos, Shorts, live links and existing embeds normalize safely', () => {
  for (const url of ['https://youtu.be/abcdefghijk', 'https://music.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/live/abcdefghijk', 'https://www.youtube.com/embed/abcdefghijk']) {
    assert.deepEqual(ui.sourceOf(url), { kind: 'video', id: 'abcdefghijk' });
  }
});
test('host lookalikes, invalid protocols and malformed video IDs are not accepted', () => {
  for (const url of ['https://youtube.com.evil.example/watch?v=abcdefghijk', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=bad', 'https://user:pass@youtube.com/watch?v=abcdefghijk']) assert.equal(ui.sourceOf(url), null);
  assert.throws(() => ui.embedUrl({ kind: 'video', id: '../bad' }, 'https://example.com'));
  assert.throws(() => ui.embedUrl({ kind: 'video', id: 'abcdefghijk' }, 'file:///tmp/app'));
});
test('player messages require both the correct frame and a trusted exact origin', () => {
  const frame = {}, other = {};
  const event = { source: frame, origin: 'https://www.youtube.com', data: JSON.stringify({ event: 'onError', info: 150 }) };
  assert.equal(ui.playerMessage(event, frame).info, 150);
  assert.equal(ui.playerMessage({ ...event, source: other }, frame), null);
  assert.equal(ui.playerMessage({ ...event, origin: 'https://www.youtube.com.evil.example' }, frame), null);
  assert.equal(ui.playerMessage({ ...event, origin: 'http://www.youtube.com' }, frame), null);
  assert.equal(ui.playerMessage({ ...event, data: 'not json' }, frame), null);
});
test('real restriction codes are honest about owner controls and error 153', () => {
  assert.match(ui.errorMessage(101), /owner/i);
  assert.match(ui.errorMessage(150), /outside YouTube/i);
  assert.match(ui.errorMessage(153), /referrer\/privacy/i);
  assert.match(ui.errorMessage(100), /private|removed/i);
  assert.doesNotMatch(ui.errorMessage(150), /nocookie|bypass/i);
});
test('playlist expansion filters invalid IDs and rebuilds untrusted embed URLs', () => {
  const result = ui.playlistTracks([{ id: 'abcdefghijk', title: '<script>bad</script>', embedUrl: 'javascript:alert(1)' }, { id: 'private', title: 'Private video' }, { id: 'lmnopqrstuv', title: 'Second track' }], failing, 'http://localhost:3000');
  assert.equal(result.length, 2);
  assert.equal(result[0].title, '<script>bad</script>'); // rendered via textContent, never HTML
  assert.equal(result[0].type, 'video');
  assert.equal(result[0].sourcePlaylistUrl, failing);
  assert.equal(new URL(result[0].embedUrl).searchParams.get('origin'), 'http://localhost:3000');
  assert.equal(new URL(result[0].embedUrl).pathname, '/embed/abcdefghijk');
  assert.equal(new URL(result[0].embedUrl).searchParams.has('list'), false);
});
test('verification implementation is preserved byte-for-byte and the existing entrypoint loads both features', () => {
  const original = fs.readFileSync(path.join(root, 'verification-ui.js'));
  const hash = crypto.createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex');
  assert.equal(hash, 'c4d73087a1d33fc8400066d0e7f1827ab8c4ce0c');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'verification_frontend.js'), 'utf8');
  assert.match(html, /<script src="verification_frontend.js"><\/script>/);
  assert.match(entry, /verification-ui\.js/);
  assert.match(entry, /freq-comfort\.js/);
  assert.match(entry, /freq-comfort\.css/);
});
test('comfort styles preserve an adequate visible YouTube viewport and reduced motion', () => {
  const css = fs.readFileSync(path.join(root, 'freq-comfort.css'), 'utf8');
  assert.match(css, /#embedFrame\.visible\{min-height:240px;min-width:200px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /focus-visible/);
});
