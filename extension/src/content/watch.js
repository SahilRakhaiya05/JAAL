/*
 * JAAL page watch for chat surfaces (WhatsApp Web, Telegram Web, Gmail, and the bundled demo chat).
 * Reads ONLY newly added incoming message nodes inside the conversation pane, runs triage on-device,
 * and hands the service worker a message only when triage says 'check' or 'trigger'.
 * Selectors prefer roles / data-attributes; class names are only one of several fallbacks.
 */
(function () {
  'use strict';
  try {
    if (window.top !== window) return;
    if (document.documentElement.getAttribute('data-jaal-watch')) return; // claimed by another copy
    document.documentElement.setAttribute('data-jaal-watch', '1');
    var X = globalThis.JaalExtract, Core = globalThis.JaalCore;
    if (!X || !Core) return;

    var SURFACES = {
      whatsapp_web: {
        pane: ['#main', '[data-testid="conversation-panel-messages"]', '[data-testid="conversation-panel-wrapper"]'],
        msg: ['[data-id]', '.message-in', '.message-out', '[role="row"]'],
        text: ['[data-pre-plain-text]', '.copyable-text', 'span.selectable-text'],
        fallback: true
      },
      telegram_web: {
        pane: ['.bubbles', '#MiddleColumn', '.MessageList', '.messages-container', '[role="main"]'],
        msg: ['[data-mid]', '[data-message-id]', '.bubble', '.Message'],
        text: ['.translatable-message', '.text-content', '.message'],
        fallback: true
      },
      gmail: {
        pane: ['[role="main"]'],
        msg: ['[data-message-id]', '[data-legacy-message-id]'],
        text: ['.a3s', '[data-message-id] [dir]'],
        fallback: false
      },
      demo: {
        pane: ['[data-jaal-pane]'],
        msg: ['[data-msg]', '[role="listitem"]'],
        text: ['[data-text]', '.text'],
        fallback: true
      }
    };

    function detect() {
      var h = location.hostname;
      if (h === 'web.whatsapp.com') return 'whatsapp_web';
      if (h === 'web.telegram.org') return 'telegram_web';
      if (h === 'mail.google.com') return 'gmail';
      if (document.querySelector('[data-jaal-pane]')) return 'demo';
      return null;
    }

    var surface = detect();
    if (!surface) return;
    var cfg = SURFACES[surface];
    var enabled = true, extAlive = true;
    var seen = new Set();
    var pending = new Set();
    var timer = null;
    var sentTimes = [];

    function alive() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; } }

    try {
      chrome.storage.local.get('settings').then(function (r) {
        enabled = !(r.settings && r.settings.rules && r.settings.rules.pageWatch === false);
      }).catch(function () {});
      chrome.storage.onChanged.addListener(function (ch) {
        if (ch.settings && ch.settings.newValue) enabled = ch.settings.newValue.rules ? ch.settings.newValue.rules.pageWatch !== false : true;
      });
    } catch (e) { extAlive = false; }

    function matchesAny(el, sels) {
      for (var i = 0; i < sels.length; i++) { try { if (el.matches(sels[i])) return true; } catch (e) { /* bad selector */ } }
      return false;
    }
    function closestAny(el, sels) {
      for (var i = 0; i < sels.length; i++) { try { var c = el.closest(sels[i]); if (c) return c; } catch (e) { /* ignore */ } }
      return null;
    }
    function inPane(el) { return !!closestAny(el, cfg.pane); }

    function descriptor(el) {
      var anc = [];
      var p = el.parentElement;
      for (var i = 0; i < 4 && p; i++, p = p.parentElement) anc.push(typeof p.className === 'string' ? p.className : '');
      // WhatsApp keeps direction on a child: .message-in / .message-out
      var inner = el.querySelector && el.querySelector('.message-out, .message-in, .is-out, .is-in');
      return {
        className: (typeof el.className === 'string' ? el.className : '') + (inner ? ' ' + inner.className : ''),
        dataId: el.getAttribute('data-id') || ((el.querySelector && el.querySelector('[data-id]')) || { getAttribute: function () { return ''; } }).getAttribute('data-id') || '',
        testid: el.getAttribute('data-testid') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        direction: el.getAttribute('data-direction') || '',
        ancestorClassNames: anc.join(' ')
      };
    }

    function textOf(el) {
      for (var i = 0; i < cfg.text.length; i++) {
        try {
          var nodes = el.matches(cfg.text[i]) ? [el] : el.querySelectorAll(cfg.text[i]);
          if (nodes.length) {
            var parts = [];
            for (var j = 0; j < nodes.length && j < 8; j++) parts.push(nodes[j].innerText || nodes[j].textContent || '');
            var t = parts.join(' ').trim();
            if (t) return t;
          }
        } catch (e) { /* ignore */ }
      }
      return el.innerText || el.textContent || '';
    }

    function collect(node) {
      if (!node || node.nodeType !== 1) {
        if (node && node.nodeType === 3 && node.parentElement) node = node.parentElement; else return;
      }
      if (node.closest('jaal-shield')) return;
      if (!inPane(node) && !node.querySelector(cfg.pane.join(','))) return;
      if (matchesAny(node, cfg.msg)) { pending.add(node); return; }
      var up = closestAny(node, cfg.msg);
      if (up && inPane(up)) { pending.add(up); return; }
      var inner = node.querySelectorAll(cfg.msg.join(','));
      if (inner.length) { for (var i = 0; i < inner.length; i++) if (inPane(inner[i])) pending.add(inner[i]); return; }
      if (cfg.fallback && inPane(node)) pending.add(node);
    }

    // Extension-hosted demo pages get no tabs.sendMessage push; show the answer directly.
    function direct(r) {
      try { if (globalThis.__jaalDirect && r && r.verdict && globalThis.JaalOverlay) globalThis.JaalOverlay.show(r.verdict); } catch (e) { /* ignore */ }
    }

    function rateOk() {
      var now = Date.now();
      sentTimes = sentTimes.filter(function (t) { return now - t < 60000; });
      if (sentTimes.length >= 6) return false;
      sentTimes.push(now);
      return true;
    }

    function flush() {
      timer = null;
      if (!enabled || !alive()) { pending.clear(); return; }
      var units = Array.from(pending).filter(function (n) { return n.isConnected; });
      pending.clear();
      // Drop units nested inside other units (keep the outermost message node).
      units = units.filter(function (u) { return !units.some(function (o) { return o !== u && o.contains(u); }); });
      var incoming = units.filter(function (u) { return !Core.isOutgoing(descriptor(u)); });
      var texts = incoming.map(textOf);
      var fresh = Core.diffNewTexts(seen, texts);
      // A burst (opening a chat) loads history: check only the latest few.
      if (fresh.length > 12) fresh = fresh.slice(-3);
      fresh.forEach(function (t) {
        try {
          var tri = X.triage(t, {});
          if (Core.gate(tri) === 'drop') return;
          if (!rateOk()) return;
          chrome.runtime.sendMessage({ type: 'jaal:message', text: t, surface: surface, level: tri.level }).then(direct, function () {});
        } catch (e) { /* ignore */ }
      });
    }

    var mo = new MutationObserver(function (records) {
      try {
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (r.type === 'childList') for (var j = 0; j < r.addedNodes.length; j++) collect(r.addedNodes[j]);
          else if (r.type === 'characterData') collect(r.target);
        }
        if (pending.size && !timer) timer = setTimeout(flush, 650);
      } catch (e) { /* never break the page */ }
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: surface === 'gmail' });

    // Demo page: what is already on screen is the scenario, check it once.
    if (surface === 'demo') {
      setTimeout(function () {
        try { document.querySelectorAll(cfg.msg.join(',')).forEach(function (n) { if (inPane(n)) pending.add(n); }); if (pending.size) flush(); } catch (e) { /* ignore */ }
      }, 400);
    }
  } catch (e) { /* never crash the host page */ }
})();
