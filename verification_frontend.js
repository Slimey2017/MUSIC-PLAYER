/* Compatibility entrypoint retained for existing index.html/deep-link pages.
 * The artist-verification implementation is unchanged in verification-ui.js.
 * Each feature loads independently; an optional UI failure cannot block it.
 */
(function () {
  'use strict';
  const base = new URL('.', document.currentScript.src);
  const load = file => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(file, base).href;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${file}`));
    document.head.append(script);
  });
  const verificationReady = load('verification-ui.js?v=comfort-1');
  window.loadVerificationSection = function () {
    const args = arguments;
    return verificationReady.then(() => window.loadVerificationSection.apply(window, args)).catch(error => {
      console.error('[verification UI]', error.message);
      const mount = document.getElementById('verificationSectionBody');
      if (mount) mount.textContent = 'Verification could not load. Refresh this page to retry.';
    });
  };
  verificationReady.catch(error => console.error('[verification UI]', error.message));
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('freq-comfort.css?v=comfort-1', base).href; document.head.append(css);
  load('freq-comfort.js?v=comfort-1').catch(error => console.error('[listening UI]', error.message));
})();
