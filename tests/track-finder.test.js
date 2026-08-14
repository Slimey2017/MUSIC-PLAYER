'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TrackFinderError,
  normalizeYouTubeUrl,
  fetchSourcePage,
  fetchYouTubeDataApiPlaylist,
  extractPlaylistId,
  parseYouTubePage,
} = require('../lib/trackFinder');

const publicLookup = async () => [{ address:'142.250.72.206', family:4 }];
const headers = obj => new Headers(obj || {});
function response(status, body, extraHeaders = {}) {
  return new Response(body, { status, headers:{ 'content-type':'text/html; charset=utf-8', ...extraHeaders } });
}
const pad = s => `${s}${' '.repeat(Math.max(0, 700 - s.length))}`;

function initialDataPage(data, extra='') {
  return pad(`<html><head><title>x</title></head><body>${extra}<script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`);
}

test('valid playlist with tracks', () => {
  const html = initialDataPage({ header:{ playlistHeaderRenderer:{ title:{ simpleText:'Mix' } } }, contents:{ playlistVideoListRenderer:{ contents:[
    { playlistVideoRenderer:{ videoId:'abcdefghijk', title:{ runs:[{text:'First'}] }, lengthText:{ simpleText:'3:01' }, thumbnail:{ thumbnails:[] } } },
    { playlistVideoRenderer:{ videoId:'lmnopqrstuv', title:{ simpleText:'Second' }, thumbnail:{ thumbnails:[] } } },
  ]}}});
  const result = parseYouTubePage(html, 'https://www.youtube.com/playlist?list=PL123');
  assert.equal(result.empty, false);
  assert.equal(result.tracks.length, 2);
  assert.equal(result.title, 'Mix');
});

test('valid empty playlist is distinct from parser failure', () => {
  const html = initialDataPage({ header:{ playlistHeaderRenderer:{ title:{ simpleText:'Empty Mix' } } }, contents:{ playlistVideoListRenderer:{ contents:[] } } }, 'This playlist is empty');
  const result = parseYouTubePage(html, 'https://www.youtube.com/playlist?list=PLEMPTY');
  assert.equal(result.empty, true);
  assert.deepEqual(result.tracks, []);
});

test('private/auth signals are explicit errors', () => {
  assert.throws(() => parseYouTubePage(pad('<html>This playlist is private</html>'), 'https://www.youtube.com/playlist?list=P'), e => e.code === 'PRIVATE_PLAYLIST');
  assert.throws(() => parseYouTubePage(pad('<html>Sign in to continue</html>'), 'https://www.youtube.com/playlist?list=P'), e => e.code === 'AUTH_REQUIRED');
});

test('HTTP 403/404/429/500 remain distinct', async () => {
  for (const [status, code] of [[403,'PRIVATE_PLAYLIST'],[404,'HTTP_ERROR'],[429,'RATE_LIMITED'],[500,'HTTP_ERROR']]) {
    await assert.rejects(() => fetchSourcePage('https://www.youtube.com/playlist?list=P', { lookup:publicLookup, fetchImpl:async()=>response(status,'x') }), e => e.code === code);
  }
});

test('malformed HTML returns PARSER_FAILED, not empty', () => {
  assert.throws(() => parseYouTubePage(pad('<html><body>normal page but no structured playlist data</body></html>'), 'https://www.youtube.com/playlist?list=P'), e => e.code === 'PARSER_FAILED');
});

test('changed renderer layout can fall back to JSON-LD', () => {
  const html = pad(`<html><script type="application/ld+json">${JSON.stringify({ '@type':'VideoObject', name:'Structured Song', url:'https://www.youtube.com/watch?v=abcdefghijk', thumbnailUrl:'https://img.test/x.jpg' })}</script></html>`);
  const result = parseYouTubePage(html, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(result.parser, 'json-ld-v1');
  assert.equal(result.tracks[0].title, 'Structured Song');
});

test('unsupported domain and invalid protocol are rejected before fetch', () => {
  assert.throws(() => normalizeYouTubeUrl('https://example.com/playlist'), e => e.code === 'UNSUPPORTED_SOURCE');
  assert.throws(() => normalizeYouTubeUrl('file:///etc/passwd'), e => e.code === 'INVALID_URL');
});

test('network timeout is FETCH_FAILED and retryable', async () => {
  const fetchImpl = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name='AbortError'; reject(e); });
  });
  await assert.rejects(() => fetchSourcePage('https://www.youtube.com/playlist?list=P', { lookup:publicLookup, fetchImpl, timeoutMs:10 }), e => e.code === 'FETCH_FAILED' && e.retryable === true);
});

test('success fetch validates content type and response size', async () => {
  await assert.rejects(() => fetchSourcePage('https://www.youtube.com/watch?v=abcdefghijk', { lookup:publicLookup, fetchImpl:async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}}) }), e => e.code === 'PARSER_FAILED');
  await assert.rejects(() => fetchSourcePage('https://www.youtube.com/watch?v=abcdefghijk', { lookup:publicLookup, maxBytes:100, fetchImpl:async()=>response(200,'x'.repeat(200)) }), e => e.code === 'SOURCE_BLOCKED');
});

test('frontend prevents duplicate Browse Tracks and Import Wizard requests', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /if \(ytTrackFinderBusy\) return;/);
  assert.match(html, /if \(_importWizardBusy\) return;/);
  assert.match(html, /data-track-finder-retry/);
});


test('YouTube Data API is primary-capable for public playlists and preserves empty state', async () => {
  const calls = [];
  const fetchImpl = async raw => {
    const u = new URL(raw); calls.push(u.pathname + '?' + u.searchParams.toString());
    assert.equal(u.hostname, 'www.googleapis.com');
    assert.equal(u.searchParams.get('key'), 'secret-test-key');
    if (u.pathname.endsWith('/playlists')) {
      return new Response(JSON.stringify({ items:[{ snippet:{ title:'API Mix' }, status:{ privacyStatus:'public' }, contentDetails:{ itemCount:2 } }] }), { status:200, headers:{'content-type':'application/json'} });
    }
    return new Response(JSON.stringify({ items:[
      { snippet:{ title:'Song One', videoOwnerChannelTitle:'Artist One', resourceId:{ videoId:'abcdefghijk' }, thumbnails:{ high:{url:'https://img/1.jpg'} } }, contentDetails:{ videoId:'abcdefghijk' } },
      { snippet:{ title:'Song Two', videoOwnerChannelTitle:'Artist Two', resourceId:{ videoId:'lmnopqrstuv' }, thumbnails:{} }, contentDetails:{ videoId:'lmnopqrstuv' } },
    ] }), { status:200, headers:{'content-type':'application/json'} });
  };
  const result = await fetchYouTubeDataApiPlaylist('https://www.youtube.com/playlist?list=PL_API_TEST', { apiKey:'secret-test-key', fetchImpl });
  assert.equal(result.parser, 'youtube-data-api-v3');
  assert.equal(result.title, 'API Mix');
  assert.equal(result.empty, false);
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks[0].artist, 'Artist One');
  assert.equal(calls.length, 2);
});

test('YouTube Data API paginates playlistItems with nextPageToken', async () => {
  let itemCalls = 0;
  const fetchImpl = async raw => {
    const u = new URL(raw);
    if (u.pathname.endsWith('/playlists')) {
      return new Response(JSON.stringify({ items:[{ snippet:{title:'Paged'}, status:{privacyStatus:'public'}, contentDetails:{itemCount:2} }] }), {status:200,headers:{'content-type':'application/json'}});
    }
    itemCalls++;
    const second = u.searchParams.get('pageToken') === 'NEXT';
    return new Response(JSON.stringify(second
      ? { items:[{ snippet:{title:'Two',resourceId:{videoId:'lmnopqrstuv'}},contentDetails:{videoId:'lmnopqrstuv'} }] }
      : { nextPageToken:'NEXT', items:[{ snippet:{title:'One',resourceId:{videoId:'abcdefghijk'}},contentDetails:{videoId:'abcdefghijk'} }] }
    ), {status:200,headers:{'content-type':'application/json'}});
  };
  const result = await fetchYouTubeDataApiPlaylist('https://www.youtube.com/playlist?list=PL_PAGED', { apiKey:'k', fetchImpl });
  assert.equal(itemCalls, 2);
  assert.deepEqual(result.tracks.map(t=>t.title), ['One','Two']);
});

test('YouTube Data API maps private, quota, and config errors explicitly', async () => {
  const cases = [
    [403, 'playlistItemsNotAccessible', 'PRIVATE_PLAYLIST'],
    [403, 'quotaExceeded', 'RATE_LIMITED'],
    [400, 'keyInvalid', 'API_CONFIG_ERROR'],
  ];
  for (const [status, reason, expected] of cases) {
    let call = 0;
    const fetchImpl = async raw => {
      call++;
      if (call === 1 && reason === 'playlistItemsNotAccessible') {
        return new Response(JSON.stringify({items:[{snippet:{title:'x'},status:{privacyStatus:'public'},contentDetails:{itemCount:1}}]}), {status:200,headers:{'content-type':'application/json'}});
      }
      return new Response(JSON.stringify({error:{errors:[{reason}],message:reason}}), {status,headers:{'content-type':'application/json'}});
    };
    await assert.rejects(() => fetchYouTubeDataApiPlaylist('https://www.youtube.com/playlist?list=PL_ERROR_123', { apiKey:'k', fetchImpl }), e => e.code === expected);
  }
});

test('YouTube Data API confirms a truly empty playlist without scraping', async () => {
  const fetchImpl = async raw => {
    const u = new URL(raw);
    if (u.pathname.endsWith('/playlists')) return new Response(JSON.stringify({items:[{snippet:{title:'Empty'},status:{privacyStatus:'public'},contentDetails:{itemCount:0}}]}), {status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({items:[]}), {status:200,headers:{'content-type':'application/json'}});
  };
  const result = await fetchYouTubeDataApiPlaylist('https://www.youtube.com/playlist?list=PL_EMPTY_API', { apiKey:'k', fetchImpl });
  assert.equal(result.empty, true);
  assert.deepEqual(result.tracks, []);
});

test('playlist ID extraction preserves list identifier', () => {
  assert.equal(extractPlaylistId('https://www.youtube.com/watch?v=abcdefghijk&list=PL_ABC-123'), 'PL_ABC-123');
  assert.equal(extractPlaylistId('https://www.youtube.com/watch?v=abcdefghijk'), null);
});
