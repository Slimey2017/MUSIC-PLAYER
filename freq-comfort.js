/* FREQ listening UI and YouTube playback adapter. No database writes or new media elements. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.FreqComfort = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.install, { once: true });
    else api.install();
  }
})(globalThis, function () {
  'use strict';
  const VIDEO = /^[A-Za-z0-9_-]{11}$/;
  const LIST = /^[A-Za-z0-9_-]{8,160}$/;
  const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']);
  const ORIGINS = new Set(['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://youtube.com', 'https://youtube-nocookie.com']);
  const isYouTube = item => !!item && ['youtube', 'ytmusic'].includes(item.platform);

  function sourceOf(item) {
    if (typeof item === 'string') item = { originalUrl: item };
    if (!item) return null;
    for (const raw of [item.originalUrl, item.embedUrl]) {
      try {
        const u = new URL(raw);
        if (!['https:', 'http:'].includes(u.protocol) || !HOSTS.has(u.hostname) || u.username || u.password || u.port) continue;
        const browse = u.pathname.match(/^\/browse\/VL([A-Za-z0-9_-]+)$/);
        const list = u.searchParams.get('list') || browse?.[1];
        const pathVideo = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];
        const video = u.searchParams.get('v') || (u.hostname === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : pathVideo);
        if (LIST.test(list || '') && (item.type === 'playlist' || !VIDEO.test(video || ''))) return { kind: 'playlist', id: list };
        if (VIDEO.test(video || '')) return { kind: 'video', id: video };
      } catch (_) { /* malformed source: try the next candidate */ }
    }
    if (item.type === 'playlist' && LIST.test(item.id || '')) return { kind: 'playlist', id: item.id };
    return VIDEO.test(item.id || '') ? { kind: 'video', id: item.id } : null;
  }

  function embedUrl(source, pageOrigin, privacy = false) {
    if (!source || !['video', 'playlist'].includes(source.kind) || !(source.kind === 'video' ? VIDEO : LIST).test(source.id)) throw new Error('Invalid YouTube source.');
    const origin = new URL(pageOrigin);
    if (!['https:', 'http:'].includes(origin.protocol)) throw new Error('A web origin is required.');
    const u = new URL(`https://${privacy ? 'www.youtube-nocookie.com' : 'www.youtube.com'}/embed/${source.kind === 'playlist' ? 'videoseries' : source.id}`);
    for (const [key, value] of Object.entries({ autoplay: '1', controls: '1', enablejsapi: '1', playsinline: '1', origin: origin.origin })) u.searchParams.set(key, value);
    if (source.kind === 'playlist') u.searchParams.set('list', source.id);
    return u.toString();
  }

  function errorMessage(code) {
    return ({
      2: 'YouTube could not read this video link. Try adding it again.',
      5: 'Your browser could not play this YouTube video. Retry or open it on YouTube.',
      100: 'This video is unavailable, private, or has been removed.',
      101: 'The owner does not allow this video to play outside YouTube.',
      150: 'The owner does not allow this video to play outside YouTube.',
      153: 'YouTube could not verify this player’s website. Try the source player or check your browser’s referrer/privacy settings.'
    })[Number(code)] || 'YouTube could not play this track. Retry, skip it, or open it on YouTube.';
  }

  function playerMessage(event, frameWindow) {
    if (event.source !== frameWindow || !ORIGINS.has(event.origin)) return null;
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      return data && typeof data === 'object' && typeof data.event === 'string' ? data : null;
    } catch (_) { return null; }
  }

  function playlistTracks(rows, originalUrl, origin) {
    return (Array.isArray(rows) ? rows : []).filter(row => row && VIDEO.test(row.id || '')).map(row => {
      const source = { kind: 'video', id: row.id };
      return { platform: 'youtube', type: 'video', id: row.id,
        title: String(row.title || row.id), artist: String(row.artist || ''),
        duration: row.duration || null, artworkUrl: safeImage(row.artwork || row.thumb),
        originalUrl: `https://www.youtube.com/watch?v=${row.id}`, sourcePlaylistUrl: originalUrl,
        embedUrl: embedUrl(source, origin), embedUrlNC: embedUrl(source, origin, true) };
    });
  }

  function safeImage(value) {
    try { const u = new URL(value, 'https://invalid.local'); return ['https:', 'http:'].includes(u.protocol) && u.hostname !== 'invalid.local' ? u.href : ''; }
    catch (_) { return ''; }
  }

  function install() {
    if (window.__freqComfortInstalled || typeof state === 'undefined') return;
    const frame = document.getElementById('embedFrame');
    const main = document.querySelector('.player-area');
    const header = document.querySelector('.header-right');
    const sidebar = document.querySelector('.sidebar');
    if (!frame || !main || !header || !sidebar) return;
    window.__freqComfortInstalled = true;
    const byId = id => document.getElementById(id);
    const read = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, value); } catch (_) { /* storage may be disabled */ } };
    const element = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const button = (label, action, parent) => { const b = element('button', 'freq-comfort-button', label); b.type = 'button'; b.addEventListener('click', action); if (parent) parent.append(b); return b; };
    const current = () => state.queue[state.activeIndex];
    const nativePlay = window.playItem;
    let attempt = 0, abort = null, context = null, homeActive = true, undo = null;
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
    function reset() { attempt++; abort?.abort(); abort = null; timers.forEach(clearTimeout); timers.clear(); context = null; notice.hidden = true; }
    function post(func, args = []) {
      if (!isYouTube(current())) return;
      try { const origin = new URL(frame.src).origin; if (ORIGINS.has(origin)) frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), origin); } catch (_) { /* not loaded */ }
    }

    const notice = element('section', 'freq-playback-notice');
    notice.id = 'freqPlaybackNotice'; notice.hidden = true; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    main.insertBefore(notice, byId('embedContainer'));
    function showNotice(message, item, extra) {
      notice.replaceChildren(element('p', '', message)); notice.hidden = false;
      const actions = element('div', 'freq-comfort-actions'); notice.append(actions);
      if (extra) button(extra.label, extra.run, actions);
      button('Retry', () => { const index = state.queue.indexOf(item); if (index >= 0) window.playItem(index); }, actions);
      const next = button('Skip track', () => { const index = state.queue.indexOf(item); if (index >= 0 && index + 1 < state.queue.length) window.playItem(index + 1); }, actions);
      next.disabled = state.queue.indexOf(item) < 0 || state.queue.indexOf(item) + 1 >= state.queue.length;
      try {
        const u = new URL(item?.originalUrl);
        if (['http:', 'https:'].includes(u.protocol) && HOSTS.has(u.hostname)) {
          const a = element('a', 'freq-comfort-button', 'Open on YouTube'); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; actions.append(a);
        }
      } catch (_) { /* no source link */ }
    }

    // Retire the oEmbed/timer heuristic. Network failures are not evidence that
    // embedding is prohibited; only actual, source-checked player errors say so.
    window.scheduleEmbedCheck = function (item) {
      byId('embedBlockBanner')?.classList.remove('visible');
      if (typeof _embedCheckTimer !== 'undefined') clearTimeout(_embedCheckTimer);
      if (typeof _currentEmbedItem !== 'undefined') _currentEmbedItem = item;
    };
    function handshake() {
      const ctx = context;
      if (!ctx || !ctx.loaded || !isYouTube(current()) || ctx.item !== current()) return;
      try {
        const origin = new URL(frame.src).origin;
        if (!ORIGINS.has(origin)) return;
        frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'embedFrame', channel: 'freq-player' }), origin);
        for (const name of ['onReady', 'onStateChange', 'onError', 'onAutoplayBlocked']) post('addEventListener', [name]);
      } catch (_) { /* iframe may still be navigating */ }
      if (!ctx.ready && ++ctx.handshakes < 16) later(handshake, 500);
    }
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('title', 'Music source player');
    frame.addEventListener('load', () => { if (context) context.loaded = true; handshake(); });

    window.playItem = async function (index) {
      if (!Number.isInteger(index) || !state.queue[index]) return;
      reset(); const token = attempt; let item = state.queue[index];
      homeActive = false; renderHome();
      if (isYouTube(item)) {
        const source = sourceOf(item);
        if (!source) { showNotice('This YouTube link does not contain a valid video or playlist ID.', item); return; }
        if (source.kind === 'playlist') {
          if (typeof QUEUE_LOCKED !== 'undefined' && QUEUE_LOCKED) {
            showNotice('Unlock the queue to expand this playlist into playable tracks.', item); return;
          }
          abort = new AbortController(); const request = abort;
          const timeout = later(() => request.abort(), 20000);
          showNotice('Reading your playlist… Your current queue is kept until its tracks are ready.', item);
          try {
            const response = await fetch('/api/yt/tracks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: item.originalUrl }), signal: request.signal });
            const data = await response.json();
            if (token !== attempt || state.queue[index] !== item) return;
            if (!response.ok || data.ok === false) throw new Error(data.message || 'Could not read this playlist. It may require YouTube authorization.');
            const tracks = playlistTracks(data.tracks, item.originalUrl, location.origin);
            if (!tracks.length) throw new Error(data.empty ? 'This playlist is empty.' : 'No public, importable tracks were found in this playlist.');
            state.queue = [...state.queue.slice(0, index), ...tracks, ...state.queue.slice(index + 1)];
            item = state.queue[index]; save(); renderQueue();
            showToast('Playlist ready', `${tracks.length} tracks added. Unavailable videos can be skipped.`, 'success');
          } catch (error) {
            if (token !== attempt) return;
            const direct = { label: 'Try source playlist player', run: () => {
              item.embedUrl = embedUrl(source, location.origin); item.embedUrlNC = embedUrl(source, location.origin, true);
              context = { item, token: attempt, ready: false, handshakes: 0, state: -1, ended: false };
              notice.hidden = true; nativePlay.call(window, index); later(handshake, 0);
            } };
            showNotice(request.signal.aborted ? 'Reading the playlist timed out. Retry or use the source player.' : error.message, item, direct);
            return;
          } finally { clearTimeout(timeout); timers.delete(timeout); if (abort === request) abort = null; }
        }
        item.embedUrl = embedUrl(sourceOf(item), location.origin);
        item.embedUrlNC = embedUrl(sourceOf(item), location.origin, true);
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        context = { item, token, ready: false, handshakes: 0, state: -1, ended: false };
      }
      if (token !== attempt) return;
      await nativePlay.call(this, index);
      if (token !== attempt) return;
      if (state.history[0]?.id === item.id && item.platform !== 'local') {
        Object.assign(state.history[0], { artist: item.artist || '', artworkUrl: item.artworkUrl || '', freqTrackId: item.freqTrackId || null, sourcePlaylistUrl: item.sourcePlaylistUrl || null }); save();
      }
      renderHome(); updateBar();
      if (context) {
        later(handshake, 0);
        later(() => { if (context?.token === token && [-1, 5].includes(context.state) && !context.failed) showNotice('If playback has not started, press Play inside the YouTube player. Your browser may require a click.', item); }, 12000);
      }
    };

    // Capture before the legacy unscoped auto-advance listener. A foreign frame
    // cannot skip tracks, and duplicate ended events cannot double-advance.
    window.addEventListener('message', event => {
      let raw; try { raw = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch (_) { return; }
      if (!['onReady', 'onStateChange', 'onError', 'onAutoplayBlocked', 'infoDelivery'].includes(raw?.event)) return;
      event.stopImmediatePropagation();
      const data = playerMessage(event, frame.contentWindow), ctx = context;
      if (!data || !ctx || !ctx.loaded || ctx.item !== current() || ctx.token !== attempt) return;
      if (data.event === 'onReady' || data.event === 'infoDelivery') ctx.ready = true;
      if (data.event === 'onError') { ctx.failed = true; showNotice(errorMessage(data.info), current()); return; }
      if (data.event === 'onAutoplayBlocked') { showNotice('Your browser paused autoplay. Press Play inside the YouTube player to continue.', current()); return; }
      const status = data.event === 'onStateChange' ? data.info : data.event === 'infoDelivery' ? data.info?.playerState : undefined;
      if (typeof status !== 'number') return;
      ctx.state = status; ctx.ready = true;
      if (status === 1) { ctx.ended = false; ctx.failed = false; notice.hidden = true; }
      updateBar();
      if (status === 0 && !ctx.ended && AQ_DEFAULTS.autoAdvance !== false) {
        ctx.ended = true;
        later(() => { if (context === ctx && ctx.token === attempt && ctx.item === current()) advanceTrack(); }, Math.max(0, Number(AQ_DEFAULTS.advanceDelay) || 0) * 1000);
      }
    }, true);

    const modeToggle = button('Comfort Mode', () => setMode(!enabled), header);
    modeToggle.id = 'freqComfortToggle'; modeToggle.setAttribute('aria-pressed', 'false');
    const more = element('details', 'freq-comfort-more'); more.hidden = true;
    more.append(element('summary', '', 'More'));
    const morePanel = element('div', 'freq-comfort-more-panel'); more.append(morePanel); header.append(more);
    const movable = [...header.querySelectorAll('.font-toggle,.accent-wrap,.theme-picker,#djBoomBtn,#premiumHubBtn,#radioBtn,#labsBtn,#audioQualityBtn,#oledToggleBtn,#miniBtn,#fullscreenBtn,#shortcutsBtn')].map(node => ({ node, marker: document.createComment('comfort control position') }));
    more.addEventListener('click', event => { if (event.target.closest('button')) more.open = false; });
    more.addEventListener('keydown', event => { if (event.key === 'Escape') { more.open = false; more.querySelector('summary').focus(); } });
    const nav = element('nav', 'freq-comfort-nav'); nav.hidden = true; nav.setAttribute('aria-label', 'Music navigation'); sidebar.prepend(nav);
    const go = view => { byId('appGrid')?.classList.remove('mini-mode', 'fullscreen'); document.querySelector(`.sidebar-view-btn[data-view="${view}"]`)?.click(); };
    button('Home', () => { homeActive = true; renderHome(); }, nav);
    button('Search', () => { homeActive = false; renderHome(); document.querySelector('.input-tab[data-tab="url"]')?.click(); byId('urlInput')?.focus(); }, nav);
    button('Your Library', () => { homeActive = false; renderHome(); go('favorites'); }, nav);
    const home = element('section', 'freq-comfort-home'); home.id = 'freqComfortHome'; home.hidden = true; home.setAttribute('aria-label', 'Your music home'); main.insertBefore(home, notice);
    function renderHome() {
      home.hidden = !enabled || !homeActive;
      document.body.classList.toggle('freq-home-active', enabled && homeActive);
      document.body.classList.toggle('freq-has-track', !!current());
      home.replaceChildren(element('h1', '', 'Find your next favorite.'));
      home.append(element('p', 'freq-comfort-subtitle', 'Your music, with a little more room to breathe.'));
      if (read('freq_comfort_tips_v1') !== 'dismissed') {
        const tips = element('aside', 'freq-comfort-tips');
        tips.append(element('p', '', 'Start with Search to paste a music link or add files. Your Library keeps favorites close. More holds the advanced tools; your source’s playback limits still apply.'));
        button('Got it', () => { write('freq_comfort_tips_v1', 'dismissed'); renderHome(); }, tips); home.append(tips);
      }
      const shelf = (title, entries) => {
        const section = element('section', 'freq-comfort-shelf'); section.append(element('h2', '', title));
        const grid = element('div', 'freq-comfort-cards'); section.append(grid);
        if (!entries.length) grid.append(element('p', 'freq-comfort-subtitle', 'Your music will appear here as you listen and save favorites.'));
        for (const item of entries.slice(0, 6)) {
          const card = button('', () => {
            const index = state.queue.findIndex(q => q === item || (q.id === item.id && q.platform === item.platform));
            if (index >= 0) window.playItem(index);
            else if (item.platform === 'freq' && item.freqTrackId && typeof playPublishedTrack === 'function') playPublishedTrack(item.freqTrackId);
            else if (isYouTube(item) || (item.embedUrl && item.platform !== 'local' && item.platform !== 'freq')) { state.queue.push({ ...item }); save(); renderQueue(); window.playItem(state.queue.length - 1); }
            else { homeActive = false; renderHome(); go('history'); showToast('Choose this track', 'Use its library entry to refresh the source link.', 'info'); }
          }, grid);
          card.className = 'freq-comfort-card';
          const src = safeImage(item.artworkUrl || item.artwork || item.thumb) || (isYouTube(item) && sourceOf(item)?.kind === 'video' ? `https://i.ytimg.com/vi/${sourceOf(item).id}/hqdefault.jpg` : '');
          if (src) { const img = element('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => img.remove(), { once: true }); card.append(img); }
          else card.append(element('span', 'freq-comfort-art', '♪'));
          card.append(element('strong', '', item.customLabel || item.title || 'Untitled track'), element('span', '', item.artist || item.platform || 'Music'));
        }
        home.append(section);
      };
      shelf('Continue listening', state.history);
      shelf('Made for your library', state.favorites);
      button('Show listening tips', () => { write('freq_comfort_tips_v1', 'show'); renderHome(); }, home);
    }

    const bar = element('section', 'freq-comfort-player'); bar.hidden = true; bar.setAttribute('aria-label', 'Playback controls');
    const track = element('div', 'freq-comfort-track'); bar.append(track);
    const controls = element('div', 'freq-comfort-actions'); bar.append(controls);
    button('Previous', () => byId('prevBtn')?.click(), controls);
    const play = button('Play', () => {
      if (!current()) return;
      if (['local', 'freq'].includes(current().platform)) PlaybackManager.toggle();
      else post(context?.state === 1 ? 'pauseVideo' : 'playVideo');
    }, controls);
    button('Next', () => byId('nextBtn')?.click(), controls);
    button('Queue', () => { go('queue'); document.querySelector('.sidebar')?.scrollIntoView({ block: 'nearest' }); }, controls);
    button('Lyrics', () => byId('lyricsBtn')?.click(), controls);
    document.body.append(bar);
    function updateBar() {
      const item = current(); track.replaceChildren(element('strong', '', item?.customLabel || item?.title || 'Ready when you are'), element('span', '', item?.artist || item?.platform || 'Choose a track to start listening'));
      play.disabled = !item || (!isYouTube(item) && !['local', 'freq'].includes(item.platform));
      const playing = isYouTube(item) ? context?.state === 1 : !localAudio.paused && !!item;
      play.textContent = playing ? 'Pause' : 'Play'; play.setAttribute('aria-label', playing ? 'Pause playback' : 'Start playback');
      document.body.classList.toggle('freq-has-track', !!item);
    }
    ['playing', 'pause', 'ended'].forEach(event => localAudio.addEventListener(event, updateBar));
    const oldRender = window.renderQueue;
    window.renderQueue = function () { const result = oldRender.apply(this, arguments); renderHome(); updateBar(); return result; };

    const undoNotice = element('section', 'freq-comfort-undo'); undoNotice.hidden = true; undoNotice.setAttribute('role', 'status');
    const undoLabel = element('span'); undoNotice.append(undoLabel);
    function expireUndo() {
      if (!undo) return;
      clearTimeout(undo.timer);
      if (undo.item.platform === 'local' && undo.item.blobUrl && !state.queue.some(q => q.blobUrl === undo.item.blobUrl)) URL.revokeObjectURL(undo.item.blobUrl);
      undo = null; undoNotice.hidden = true;
    }
    button('Undo', () => {
      if (!undo) return;
      if (typeof QUEUE_LOCKED !== 'undefined' && QUEUE_LOCKED) { showToast('Queue locked', 'Unlock the queue to restore this track.', 'info'); return; }
      const entry = undo; clearTimeout(entry.timer); undo = null; undoNotice.hidden = true;
      const index = Math.min(entry.index, state.queue.length);
      state.queue.splice(index, 0, entry.item); if (state.activeIndex >= index) state.activeIndex++;
      save(); renderQueue();
    }, undoNotice);
    document.body.append(undoNotice);
    window.removeItem = function (index) {
      if (!Number.isInteger(index) || !state.queue[index]) return;
      if (typeof QUEUE_LOCKED !== 'undefined' && QUEUE_LOCKED) { showToast('Queue locked', 'Unlock the queue to remove tracks.', 'info'); return; }
      expireUndo(); const item = state.queue[index];
      if (state.activeIndex === index) {
        reset(); if (typeof MP_STATE !== 'undefined') MP_STATE.playToken++;
        if (typeof CrossfadeManager !== 'undefined' && CrossfadeManager.isActive()) CrossfadeManager.cancel(false);
        if (typeof MP_STATE !== 'undefined' && MP_STATE.activeEarn) stopMpEarnSession();
        PlaybackManager.requestPause(); state.activeIndex = -1; showWelcome();
      } else if (state.activeIndex > index) state.activeIndex--;
      playSfx('remove'); state.queue.splice(index, 1);
      undo = { item, index, timer: setTimeout(expireUndo, 10000) };
      undoLabel.textContent = `Removed ${item.customLabel || item.title || 'track'}.`; undoNotice.hidden = false;
      save(); renderQueue();
    };
    let enabled = read('freq_comfort_mode_v1') === 'on';
    function setMode(value) {
      enabled = !!value; document.documentElement.dataset.freqComfort = String(enabled); write('freq_comfort_mode_v1', enabled ? 'on' : 'off');
      modeToggle.setAttribute('aria-pressed', String(enabled)); modeToggle.textContent = enabled ? 'Classic Mode' : 'Comfort Mode';
      nav.hidden = !enabled; more.hidden = !enabled; bar.hidden = !enabled;
      for (const entry of movable) {
        if (enabled && !entry.marker.isConnected) { entry.node.before(entry.marker); morePanel.append(entry.node); }
        else if (!enabled && entry.marker.isConnected) entry.marker.replaceWith(entry.node);
      }
      renderHome(); updateBar();
    }
    const fitHeader = () => document.documentElement.style.setProperty('--freq-header-height', `${document.querySelector('header').getBoundingClientRect().height}px`);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitHeader).observe(document.querySelector('header'));
    setMode(enabled); fitHeader();
  }
  return { sourceOf, embedUrl, errorMessage, playerMessage, playlistTracks, install };
});
