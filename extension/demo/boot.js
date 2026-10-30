/*
 * Demo bootstrap. On http://localhost (npm run demo) the extension's content scripts run by themselves.
 * When a demo page is opened from inside the extension (chrome-extension://<id>/demo/...), Chrome does
 * not inject content scripts, so load the same files here and show answers directly.
 */
(function () {
  'use strict';
  if (location.protocol !== 'chrome-extension:') return;
  globalThis.__jaalDirect = true;
  var files = ['../lib/extract.js', '../src/core.js', '../lib/ring.js', '../src/card.js', '../src/content/overlay.js', '../src/content/paste.js', '../src/content/watch.js'];
  (function next(i) {
    if (i >= files.length) return ready();
    var s = document.createElement('script');
    s.src = files[i];
    s.onload = s.onerror = function () { next(i + 1); };
    document.head.appendChild(s);
  })(0);
  function ready() {
    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area !== 'local' || !ch.latest || !ch.latest.newValue) return;
        var l = ch.latest.newValue;
        if (l.kind === 'question' && !l.q.answer && globalThis.JaalOverlay) globalThis.JaalOverlay.showQuestion(l.q);
      });
    } catch (e) { /* ignore */ }
  }
})();
