/*
 * JAAL in-page overlay. Runs in every top-level page (isolated world).
 * A closed shadow root hosts the VerdictCard so page CSS cannot touch it and the page cannot read it.
 * The service worker pushes { type: 'jaal:show' | 'jaal:question' | 'jaal:hide' } to frame 0.
 */
(function () {
  'use strict';
  try {
    if (window.top !== window) return;            // overlay lives in the top frame only
    if (globalThis.JaalOverlay) return;
    var Core = globalThis.JaalCore, Card = globalThis.JaalCard;
    if (!Core || !Card) return;

    var host = null, shadow = null, dim = null, wrap = null, live = null, current = null, lang = 'en';

    function alive() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; } }
    function send(msg) { try { if (alive()) chrome.runtime.sendMessage(msg).catch(function () {}); } catch (e) { /* context gone */ } }

    function ensure() {
      if (host && host.isConnected) return;
      host = document.createElement('jaal-shield');
      host.setAttribute('style', 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;contain:layout style;');
      shadow = host.attachShadow({ mode: 'closed' });
      var base = ':host{all:initial}' +
        '.dim{position:fixed;inset:0;background:rgba(10,12,15,.34);opacity:0;transition:opacity 220ms cubic-bezier(0.2,0.8,0.2,1);pointer-events:none}' +
        '.dim.on{opacity:1;pointer-events:auto;cursor:pointer}' +
        '.wrap{position:fixed;top:16px;right:16px;pointer-events:auto;max-height:calc(100vh - 32px);overflow:auto;border-radius:20px}' +
        '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
        '@media (prefers-reduced-motion:reduce){.dim{transition:none}}';
      var css = base + '\n' + Card.css;
      try {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];       // not subject to the page's style-src CSP
      } catch (e) {
        var st = document.createElement('style');
        st.textContent = css;
        shadow.appendChild(st);
      }
      dim = document.createElement('div');
      dim.className = 'dim';
      dim.addEventListener('click', function () { hide(); });
      var outer = document.createElement('div');
      outer.className = 'wrap';
      wrap = document.createElement('div');
      wrap.className = 'jc-root';   // .jc-root resets with all:initial, so it must not be the positioned box
      outer.appendChild(wrap);
      live = document.createElement('div');
      live.className = 'sr';
      live.setAttribute('aria-live', 'polite');
      shadow.appendChild(dim);
      shadow.appendChild(outer);
      shadow.appendChild(live);
      (document.body || document.documentElement).appendChild(host);
    }

    function place(anchor) {
      var box = wrap.parentNode;
      box.style.top = '16px'; box.style.right = '16px'; box.style.left = 'auto';
      if (!anchor) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var w = Math.min(vw - 32, 400);
      var left = Math.max(16, Math.min(vw - w - 16, anchor.left));
      var top = anchor.bottom + 10;
      if (top + 260 > vh) top = Math.max(16, anchor.top - 270);
      box.style.left = left + 'px'; box.style.right = 'auto'; box.style.top = top + 'px';
    }

    function mount(card, opts) {
      ensure();
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(card);
      current = card;
      place(opts && opts.anchor);
      dim.classList.toggle('on', !!(opts && opts.dim));
      live.setAttribute('aria-live', opts && opts.assertive ? 'assertive' : 'polite');
      live.textContent = '';
      setTimeout(function () { live.textContent = (opts && opts.announce) || ''; }, 50);
    }

    function hide() {
      if (!current) return;
      var c = current;
      current = null;
      if (dim) dim.classList.remove('on');
      c.classList.remove('jc-enter');
      c.classList.add('jc-exit');
      setTimeout(function () { try { c.remove(); } catch (e) { /* gone */ } }, 150);
    }

    function show(v, opts) {
      if (!Core.shouldShow(v)) return;
      var o = opts || {};
      var card = Card.build(v, {
        lang: lang,
        surface: v.surface,
        onDismiss: hide,
        onDetails: function () { send({ type: 'jaal:openPanel', verdictId: v.id }); },
        onDispute: function () { send({ type: 'jaal:openPanel', verdictId: v.id, dispute: true }); },
        onAction: function (a) {
          if ((a.id === 'share_family' && !a.href) || a.id === 'dispute') { send({ type: 'jaal:openPanel', verdictId: v.id, action: a.id }); return true; }
          return false;
        }
      });
      mount(card, { anchor: o.anchor, dim: v.state === 'confirmed', assertive: v.state === 'confirmed', announce: Core.stateMeta(v.state, lang).word + '. ' + v.headline });
    }

    function showQuestion(q) {
      var card = Card.buildQuestion(q, {
        lang: lang,
        onDismiss: hide,
        onAnswer: function (yes) { send({ type: 'jaal:dlAnswer', downloadId: q.downloadId, yes: yes }); },
        onCancel: function () { send({ type: 'jaal:dlCancel', downloadId: q.downloadId }); },
        onRemove: function () { send({ type: 'jaal:dlRemove', downloadId: q.downloadId }); }
      });
      mount(card, { assertive: true, announce: Core.strings(lang).dlQuestion });
    }

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && current) hide(); }, true);

    try {
      chrome.storage.local.get('settings').then(function (r) { lang = (r.settings && r.settings.lang) || 'en'; }).catch(function () {});
      chrome.storage.onChanged.addListener(function (ch) { if (ch.settings && ch.settings.newValue) lang = ch.settings.newValue.lang || 'en'; });
      chrome.runtime.onMessage.addListener(function (msg) {
        try {
          if (!msg || typeof msg.type !== 'string') return;
          if (msg.type === 'jaal:show') show(msg.verdict, { anchor: msg.anchor });
          else if (msg.type === 'jaal:question') showQuestion(msg.q);
          else if (msg.type === 'jaal:hide') hide();
        } catch (e) { /* never break the page */ }
      });
    } catch (e) { /* not in an extension context (demo page outside extension) */ }

    globalThis.JaalOverlay = { show: show, showQuestion: showQuestion, hide: hide };
  } catch (e) { /* never crash the host page */ }
})();
