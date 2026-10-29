/*
 * JAAL paste intercept. Listens to the `paste` event only (capture phase), never reads the clipboard
 * any other way and never blocks the paste. Only payable identifiers (UPI handle, bank account, crypto
 * address) are passed to the service worker; the pasted text itself never leaves this script.
 */
(function () {
  'use strict';
  try {
    if (globalThis.__jaalPaste) return;
    globalThis.__jaalPaste = true;
    var X = globalThis.JaalExtract, Core = globalThis.JaalCore;
    if (!X || !Core) return;
    var enabled = true;

    try {
      chrome.storage.local.get('settings').then(function (r) {
        enabled = !(r.settings && r.settings.rules && r.settings.rules.paste === false);
      }).catch(function () {});
      chrome.storage.onChanged.addListener(function (ch) {
        if (ch.settings && ch.settings.newValue) enabled = ch.settings.newValue.rules ? ch.settings.newValue.rules.paste !== false : true;
      });
    } catch (e) { /* not in extension context */ }

    function rectOf(t) {
      try {
        var el = t && t.nodeType === 1 ? t : (document.activeElement || null);
        if (!el || !el.getBoundingClientRect) return null;
        var r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
      } catch (e) { return null; }
    }

    document.addEventListener('paste', function (e) {
      try {
        if (!enabled || !e.clipboardData) return;
        var text = e.clipboardData.getData('text/plain') || '';
        if (!text || text.length > 600) return;     // payment fields get short pastes; skip documents
        var pay = Core.payables(X.extract(text));
        if (!pay.length) return;
        var ids = pay.slice(0, 3).map(function (x) { return { type: x.type, value: x.value }; });
        var inTop = window.top === window;
        chrome.runtime.sendMessage({
          type: 'jaal:paste',
          identifiers: ids,
          anchor: inTop ? rectOf(e.target) : null,
          host: location.hostname
        }).then(function (r) {
          // Extension-hosted demo pages get no tabs.sendMessage push; show the answer directly.
          if (globalThis.__jaalDirect && r && r.verdict && globalThis.JaalOverlay) globalThis.JaalOverlay.show(r.verdict, { anchor: inTop ? rectOf(e.target) : null });
        }, function () {});
      } catch (err) { /* never interfere with the paste */ }
    }, true);
  } catch (e) { /* never crash the host page */ }
})();
