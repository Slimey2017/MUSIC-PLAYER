'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const tf = require(path.join(root, 'lib', 'trackFinder.js'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('Flawless design tokens exist', () => {
  assert(html.includes('--font-xs:12px'));
  assert(html.includes('--space-4:16px'));
  assert(html.includes('--text-primary:#f7f3ff'));
});

test('queue owns a real vertical scroll viewport', () => {
  assert(/#viewQueue #queueList\{[^}]*overflow-y:auto/.test(html));
  assert(/#viewQueue\.sidebar-panel\.active\{[^}]*display:flex/.test(html));
});

test('coarse pointers are not forced into HTML drag reorder', () => {
  assert(html.includes("matchMedia?.('(pointer: coarse)').matches"));
  assert(html.includes('card.draggable = false'));
});

test('queue rows are keyboard reachable', () => {
  assert(html.includes("card.setAttribute('role', 'button')"));
  assert(html.includes("event.key === 'Enter' || event.key === ' '"));
});

test('artist report button resolves to shared report system', () => {
  assert(html.includes('function reportArtistProfile()'));
  assert(html.includes("openReportModal('artist', artist.id"));
});

test('layered surfaces share body scroll ownership', () => {
  assert(html.includes('const FREQ_BODY_SCROLL_LOCK'));
  assert(html.includes("FREQ_BODY_SCROLL_LOCK.lock('messages')"));
  assert(html.includes("FREQ_BODY_SCROLL_LOCK.lock('release-view')"));
  assert(html.includes("FREQ_BODY_SCROLL_LOCK.unlock('messages')"));
});

test('major settings categories include lyrics and security', () => {
  assert(html.includes("'lyrics'"));
  assert(html.includes("'security'"));
  assert(html.includes("artist:'Artist Settings'"));
});

test('Local Lyrics remains IndexedDB-backed', () => {
  assert(html.includes('indexedDB.open(LOCAL_LYRICS_DB.name'));
  assert(html.includes('Save Locally'));
});

test('message reports preserve moderation snapshots server-side', () => {
  assert(server.includes("app.post('/api/messages/:messageId/report'"));
  assert(server.includes('moderation_snapshot: snapshot'));
  assert(server.includes('moderation_message_actions'));
});

test('admin moderation still has server-side admin authorization', () => {
  assert(server.includes('async function requireAdmin'));
  assert(server.includes('if (!sess.isAdmin)'));
});

test('rights diagnostics expose unavailable fingerprint component', () => {
  assert(server.includes("app.get('/api/admin/rights/diagnostics', requireAdmin"));
  assert(server.includes('fpcalc is unavailable'));
});

test('Track Finder rejects unsupported protocols/domains', () => {
  assert.throws(() => tf.normalizeYouTubeUrl('javascript:alert(1)'));
  assert.throws(() => tf.normalizeYouTubeUrl('https://example.com/list?id=x'));
});

test('Track Finder private-address helper blocks loopback', () => {
  assert.strictEqual(tf.isPrivateIp('127.0.0.1'), true);
  assert.strictEqual(tf.isPrivateIp('10.1.2.3'), true);
});

test('reduced-motion support exists globally', () => {
  assert(html.includes('@media (prefers-reduced-motion:reduce)'));
  assert(html.includes('animation-duration:.01ms!important'));
});


test('no statically referenced inline handler is missing', () => {
  const attrs = [...html.matchAll(/on(?:click|change|input|submit|keydown|contextmenu)=["']([^"']+)/gi)].map(m => m[1]);
  const handlers = attrs.map(x => x.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1]).filter(Boolean).filter(x => x !== 'if' && x !== '$');
  const declared = new Set([
    ...[...html.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]),
    ...[...html.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]),
  ]);
  const missing = [...new Set(handlers)].filter(x => !declared.has(x));
  assert.deepStrictEqual(missing, []);
});

test('publish cover preview has alternative text', () => {
  assert(/<img[^>]*id="publishCoverPreviewImg"[^>]*alt=/.test(html));
});

test('major dialogs carry dialog semantics', () => {
  for (const id of ['ytTrackModal','reportOverlay','adminDashOverlay','artistDashboardOverlay','freqSettingsOverlay','lyricsStudioOverlay','localLyricsStudioOverlay']) {
    const re = new RegExp(`<div[^>]*id="${id}"[^>]*role="dialog"`);
    assert(re.test(html), `${id} missing role=dialog`);
  }
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('✓', name); passed++; }
    catch (e) { console.error('✗', name); console.error(e.stack || e); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} smoke checks passed`);
})();
