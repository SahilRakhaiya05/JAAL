/*
 * JAAL VerdictCard (+ StateChip, RingCanvas thumbnail, ReasonLine, ActionPair, DisputeLink).
 * One DOM builder used by the in-page overlay (inside a closed shadow root) and by extension pages.
 * Never uses innerHTML (Gmail enforces Trusted Types). Depends on globalThis.JaalCore.
 */
(function (root) {
  'use strict';
  if (root.JaalCard) return;
  var Core = root.JaalCore;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var CSS = [
    '.jc-root{--ink-900:#0A0C0F;--ink-700:#16191D;--ink-500:#2A2F35;--paper:#FBFAF7;--text-hi:#F4F3F0;--text-lo:#9BA1A8;--brand:#6E5BFF;',
    '--caution:#F2A93B;--confirmed:#E5484D;--confirmed-tint:rgba(229,72,77,.12);',
    '--font:"Inter","Noto Sans Devanagari","Noto Sans Gujarati",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
    '--ease:cubic-bezier(0.2,0.8,0.2,1);all:initial;display:block;font:400 15px/22px var(--font);color:var(--text-hi);-webkit-font-smoothing:antialiased}',
    '.jc-root *{box-sizing:border-box}',
    '.jc{position:relative;width:min(calc(100vw - 32px),400px);background:var(--ink-900);border:1px solid var(--ink-500);border-radius:20px;padding:20px;color:var(--text-hi);font:400 15px/22px var(--font);text-align:left;overflow:hidden}',
    '.jc.wide{width:100%}',
    '.jc.reported::before{content:"";position:absolute;left:0;top:20px;bottom:20px;width:2px;border-radius:2px;background:var(--caution)}',
    '.jc.confirmed{background:linear-gradient(var(--confirmed-tint),var(--confirmed-tint)),var(--ink-900);border-color:rgba(229,72,77,.55)}',
    '.jc.local::before{content:"";position:absolute;left:0;top:20px;bottom:20px;width:2px;border-radius:2px;background:var(--text-lo)}',
    '.jc.question::before{content:"";position:absolute;left:0;top:20px;bottom:20px;width:2px;border-radius:2px;background:var(--brand)}',
    '.jc-head{display:flex;align-items:center;gap:10px;min-height:24px;margin:-4px -12px 10px 0}',
    '.jc-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border-radius:12px;border:1px solid currentColor;font:600 12px/14px var(--font);letter-spacing:.01em;white-space:nowrap}',
    '.jc-chip svg{width:12px;height:12px;flex:none}',
    '.t-confirmed .jc-chip,.jc.confirmed .jc-chip{color:var(--confirmed);background:rgba(229,72,77,.10)}',
    '.jc.reported .jc-chip{color:var(--caution)}',
    '.jc.local .jc-chip{color:var(--text-hi);border-color:var(--ink-500)}',
    '.jc.question .jc-chip{color:#B4A9FF;border-color:rgba(110,91,255,.6)}',
    '.jc-src{font:400 13px/18px var(--font);color:var(--text-lo);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}',
    '.jc-x{flex:none;width:48px;height:48px;margin:-12px 0;display:inline-flex;align-items:center;justify-content:center;background:none;border:0;border-radius:24px;color:var(--text-lo);cursor:pointer;padding:0}',
    '.jc-x:hover{color:var(--text-hi);background:rgba(255,255,255,.04)}',
    '.jc-x svg{width:16px;height:16px}',
    '.jc-verdict{margin:0 0 6px;font:600 22px/26px var(--font);color:var(--text-hi);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.jc-reason{margin:0;font:400 15px/22px var(--font);color:var(--text-lo);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.jc.wide .jc-reason{-webkit-line-clamp:4}',
    '.jc-ring{display:flex;align-items:center;gap:14px;height:72px;margin:14px 0 0}',
    '.jc-ring-canvas{width:72px;height:72px;flex:none;border-radius:12px;background:rgba(10,12,15,.6);border:1px solid var(--ink-500);overflow:hidden;display:flex;align-items:center;justify-content:center}',
    '.jc-ring-canvas.big{width:100%;height:240px}',
    '.jc-ring.big{height:auto;display:block}',
    '.jc-ring-canvas svg{display:block;width:100%;height:100%}',
    '.jc-stats{font:400 13px/18px var(--font);color:var(--text-lo)}',
    '.jc-stats b{font-weight:600;color:var(--text-hi)}',
    '.jc-local-note{display:flex;gap:8px;align-items:center;margin:12px 0 0;font:400 11px/14px var(--font);color:var(--text-lo)}',
    '.jc-local-note svg{width:12px;height:12px;flex:none}',
    '.jc-actions{display:flex;gap:10px;margin:16px 0 0}',
    '.jc-btn{flex:1;min-width:0;min-height:48px;padding:7px 12px;border-radius:12px;font:600 15px/18px var(--font);cursor:pointer;border:1px solid var(--ink-500);background:transparent;color:var(--text-hi);display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;text-align:center}',
    '.jc-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}',
    '.jc-btn:hover{filter:brightness(1.08)}',
    '.jc-btn:focus-visible,.jc-x:focus-visible,.jc-link:focus-visible{outline:2px solid #B4A9FF;outline-offset:2px}',
    '.jc-foot{display:flex;justify-content:space-between;align-items:center;margin:6px -8px -14px}',
    '.jc-link{min-height:48px;display:inline-flex;align-items:center;padding:0 8px;background:none;border:0;font:400 13px/18px var(--font);color:var(--text-lo);cursor:pointer;text-decoration:underline;text-underline-offset:3px}',
    '.jc-link:hover{color:var(--text-hi)}',
    '.jc-callout{margin:14px 0 0;padding:14px;border-radius:12px;background:var(--ink-700);border:1px solid var(--ink-500);font:400 13px/18px var(--font);color:var(--text-hi)}',
    '.jc-callout .num{font:600 28px/32px var(--font);letter-spacing:.04em;display:block;margin:0 0 6px}',
    '.jc-callout ol{margin:8px 0 0;padding-left:18px}',
    '.jc-callout li{margin:4px 0}',
    '.jc-callout p{margin:0}',
    '.jc-ids{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0}',
    '.jc-id{font:400 11px/14px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--text-hi);background:var(--ink-700);border:1px solid var(--ink-500);border-radius:8px;padding:5px 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.jc-id.s-reported{border-color:rgba(242,169,59,.6)}.jc-id.s-confirmed{border-color:rgba(229,72,77,.7)}',
    '.jc-enter{animation:jc-in 220ms var(--ease) both}',
    '.jc-exit{animation:jc-out 140ms ease-in both}',
    '@keyframes jc-in{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}',
    '@keyframes jc-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(8px)}}',
    '.jc-ring-canvas .pulse{animation:jc-pulse 1.6s ease-out 900ms 2}',
    '@keyframes jc-pulse{0%{opacity:.9}50%{opacity:.35}100%{opacity:.9}}',
    '.jc-reveal{opacity:0;animation:jc-fade 260ms var(--ease) both}',
    '@keyframes jc-fade{from{opacity:0}to{opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.jc-enter,.jc-exit,.jc-ring-canvas .pulse,.jc-reveal{animation:none!important;opacity:1!important}}'
  ].join('\n');

  // ---------- tiny DOM helpers ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /** Icon shapes so state is never colour alone: octagon = confirmed, triangle = reported, diamond = on-device. */
  function icon(name) {
    var s = svg('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
    var stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
    function add(tag, a) { var n = svg(tag, Object.assign({}, stroke, a)); s.appendChild(n); return n; }
    switch (name) {
      case 'octagon': add('polygon', { points: '5.2,1.5 10.8,1.5 14.5,5.2 14.5,10.8 10.8,14.5 5.2,14.5 1.5,10.8 1.5,5.2' }); add('path', { d: 'M8 4.8v3.8M8 11.1v.1' }); break;
      case 'triangle': add('path', { d: 'M8 1.8 15 14H1z' }); add('path', { d: 'M8 6.2v3.6M8 12v.1' }); break;
      case 'diamond': add('path', { d: 'M8 1.5 14.5 8 8 14.5 1.5 8z' }); add('circle', { cx: '8', cy: '8', r: '1.6', fill: 'currentColor' }); break;
      case 'circle': add('circle', { cx: '8', cy: '8', r: '6.5' }); add('path', { d: 'M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1v.4M8 11.6v.1' }); break;
      case 'x': add('path', { d: 'M3.5 3.5l9 9M12.5 3.5l-9 9' }); break;
      case 'lock': add('rect', { x: '3', y: '7', width: '10', height: '7.5', rx: '1.5' }); add('path', { d: 'M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7' }); break;
      default: add('path', { d: 'M3 8.5 6.5 12 13 4.5' });
    }
    return s;
  }

  function stateChip(state, lang) {
    var m = Core.stateMeta(state, lang);
    var c = el('span', 'jc-chip');
    c.appendChild(icon(m.icon));
    c.appendChild(el('span', '', m.word));
    return c;
  }

  // ---------- ring ----------
  /** Fallback ring when shared/ring.js is not available. Same geometry rules as SPEC (hop1 r=64, hop2 r=128, scaled). */
  function fallbackRing(container, ring, opts) {
    var size = (opts && opts.size) || 72;
    var animate = !!(opts && opts.animate) && !reducedMotion();
    var s = svg('svg', { viewBox: '-150 -150 300 300', role: 'img', 'aria-label': ringLabel(ring) });
    var nodes = (ring && ring.nodes) || [];
    var pos = {};
    var byHop = { 0: [], 1: [], 2: [] };
    nodes.forEach(function (n) { (byHop[n.hop] || byHop[2]).push(n); });
    if (!byHop[0].length && nodes.length) byHop[0].push(nodes[0]);
    var R = { 0: 0, 1: 64, 2: 128 };
    [0, 1, 2].forEach(function (h) {
      var list = byHop[h];
      list.forEach(function (n, i) {
        var a = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2 + (h === 2 ? 0.3 : 0);
        pos[n.id] = { x: Math.cos(a) * R[h], y: Math.sin(a) * R[h], n: n, i: i };
      });
    });
    var center = ring && ring.center;
    var gE = svg('g', {});
    var gN = svg('g', {});
    s.appendChild(gE); s.appendChild(gN);
    ((ring && ring.edges) || []).forEach(function (e) {
      var a = pos[e.source], b = pos[e.target];
      if (!a || !b) return;
      var l = svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#9BA1A8', 'stroke-opacity': '0.2', 'stroke-width': size < 120 ? 3 : 1.5 });
      if (animate) { l.setAttribute('class', 'jc-reveal'); l.style.animationDelay = '200ms'; }
      gE.appendChild(l);
    });
    Object.keys(pos).forEach(function (id) {
      var p = pos[id], n = p.n;
      var d = Math.max(6, Math.min(18, 6 + Math.sqrt(n.reports || 0) * 2.4));
      var scale = size < 120 ? 1.9 : 1;
      var isCenter = id === center || n.hop === 0;
      var color = isCenter ? '#6E5BFF' : (n.confirmed ? '#E5484D' : '#9BA1A8');
      var c = svg('circle', { cx: p.x, cy: p.y, r: (d / 2) * scale * (isCenter ? 1.3 : 1), fill: color, 'fill-opacity': (isCenter || n.confirmed) ? '1' : '0.4' });
      if (animate) {
        var delay = isCenter ? 0 : (n.hop === 1 ? 150 + p.i * 24 : 500 + p.i * 12);
        c.setAttribute('class', 'jc-reveal');
        c.style.animation = 'jc-fade 260ms cubic-bezier(0.2,0.8,0.2,1) ' + delay + 'ms both' + (n.confirmed ? ', jc-pulse 1.6s ease-out 900ms 2' : '');
      }
      gN.appendChild(c);
    });
    container.appendChild(s);
  }

  function ringLabel(ring) {
    var n = (ring && ring.nodes && ring.nodes.length) || 0;
    var c = ((ring && ring.nodes) || []).filter(function (x) { return x.confirmed; }).length;
    return 'Ring of ' + n + ' linked identifiers, ' + c + ' confirmed';
  }

  function reducedMotion() {
    try { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  function renderRing(container, ring, opts) {
    var o = Object.assign({ size: 72, animate: false, compact: true }, opts || {});
    if (reducedMotion()) o.animate = false;
    try {
      if (root.JaalRing && typeof root.JaalRing.render === 'function') {
        root.JaalRing.render(container, ring, o);
        if (container.childNodes.length) return 'jaalring';
      }
    } catch (e) { /* fall through to fallback */ }
    while (container.firstChild) container.removeChild(container.firstChild);
    fallbackRing(container, ring, o);
    return 'fallback';
  }

  // ---------- card ----------
  /**
   * build(verdict, opts) -> HTMLElement (.jc)
   * opts: { lang, surface, wide, showRing ('auto'|true|false), ringSize, animateRing, onDismiss(), onDetails(), onDispute(v), onAction(a, v) }
   */
  function build(v, opts) {
    var o = opts || {};
    var lang = o.lang || 'en';
    var S = Core.strings(lang);
    var state = v.state || 'clear';
    var card = el('section', 'jc ' + state + (o.wide ? ' wide' : ''));
    card.setAttribute('role', state === 'confirmed' ? 'alert' : 'status');
    card.setAttribute('lang', lang);
    var hid = 'jc-h-' + Math.random().toString(36).slice(2, 8);
    card.setAttribute('aria-labelledby', hid);

    var head = el('div', 'jc-head');
    head.appendChild(stateChip(state, lang));
    head.appendChild(el('span', 'jc-src', Core.surfaceLabel(v.surface || o.surface)));
    if (o.onDismiss) {
      var x = el('button', 'jc-x');
      x.type = 'button';
      x.setAttribute('aria-label', S.close);
      x.appendChild(icon('x'));
      x.addEventListener('click', function () { o.onDismiss(); });
      head.appendChild(x);
    }
    card.appendChild(head);

    var h = el('h2', 'jc-verdict', Core.clampText(v.headline, 120));
    h.id = hid;
    card.appendChild(h);
    if (v.reason) card.appendChild(el('p', 'jc-reason', Core.clampText(v.reason, 400)));

    var wantRing = o.showRing === true || (o.showRing !== false && state === 'confirmed');
    if (wantRing && v.ring && v.ring.nodes && v.ring.nodes.length) {
      var big = !!o.ringSize && o.ringSize > 72;
      var row = el('div', 'jc-ring' + (big ? ' big' : ''));
      var canvas = el('div', 'jc-ring-canvas' + (big ? ' big' : ''));
      row.appendChild(canvas);
      var stats = el('div', 'jc-stats');
      var st = v.stats || {};
      var b1 = el('b', '', String(v.ring.nodes.length));
      stats.appendChild(b1);
      stats.appendChild(document.createTextNode(' ' + S.ringMembers));
      if (st.confirmedWithin2Hops) {
        stats.appendChild(document.createElement('br'));
        stats.appendChild(el('b', '', String(st.confirmedWithin2Hops)));
        stats.appendChild(document.createTextNode(' confirmed within 2 hops'));
      }
      if (v.campaign && v.campaign.name) {
        stats.appendChild(document.createElement('br'));
        stats.appendChild(document.createTextNode(Core.clampText(v.campaign.name, 48)));
      }
      if (big) stats.style.marginTop = '10px';
      row.appendChild(stats);
      card.appendChild(row);
      var animate = o.animateRing != null ? o.animateRing : state === 'confirmed';
      renderRing(canvas, v.ring, big ? { width: 360, height: 240, size: 240, animate: animate && state === 'confirmed', compact: false } : { size: 72, width: 72, height: 72, animate: animate && state === 'confirmed', compact: true });
    }

    if (o.showIds && v.identifiers && v.identifiers.length) {
      var ids = el('div', 'jc-ids');
      v.identifiers.slice(0, 8).forEach(function (i) {
        var chip = el('span', 'jc-id' + (i.state ? ' s-' + i.state : ''), i.type + ' · ' + i.value + (i.reports ? ' · ' + i.reports : ''));
        chip.title = i.type + ':' + i.value;
        ids.appendChild(chip);
      });
      card.appendChild(ids);
    }

    if (state === 'local') {
      var note = el('p', 'jc-local-note');
      note.appendChild(icon('lock'));
      note.appendChild(el('span', '', S.localNote));
      card.appendChild(note);
    }

    var callout = el('div', 'jc-callout');
    callout.hidden = true;

    // DisputeLink lives in the footer, so keep it out of the ActionPair when the footer shows it.
    var actions = (v.actions || []).filter(function (a) { return !(a.id === 'dispute' && o.onDispute); }).slice(0, 2);
    if (actions.length) {
      var pair = el('div', 'jc-actions');
      actions.forEach(function (a, i) {
        var b = el('button', 'jc-btn' + (i === 0 ? ' primary' : ''), a.label || a.id);
        b.type = 'button';
        b.addEventListener('click', function () { handleAction(a, v, o, callout, lang); });
        pair.appendChild(b);
      });
      card.appendChild(pair);
    }
    card.appendChild(callout);

    if (o.onDetails || (o.onDispute && state !== 'local')) {
      var foot = el('div', 'jc-foot');
      if (o.onDetails) {
        var d = el('button', 'jc-link', S.details);
        d.type = 'button';
        d.addEventListener('click', function () { o.onDetails(v); });
        foot.appendChild(d);
      } else foot.appendChild(el('span'));
      if (o.onDispute && state !== 'local') {
        var dl = el('button', 'jc-link', S.dispute);
        dl.type = 'button';
        dl.addEventListener('click', function () { o.onDispute(v); });
        foot.appendChild(dl);
      }
      card.appendChild(foot);
    }
    if (o.animate !== false) card.classList.add('jc-enter');
    return card;
  }

  function copyText(t) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); });
    } catch (e) { /* ignore */ }
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t) {
    try {
      var ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function handleAction(a, v, o, callout, lang) {
    try {
      if (o.onAction && o.onAction(a, v) === true) return; // host handled it fully
      if (a.id === 'call_1930') {
        clear(callout);
        callout.appendChild(el('span', 'num', '1930'));
        callout.appendChild(el('p', '', 'National Cyber Crime Helpline, 24x7. Say:'));
        var ol = el('ol');
        ['"I want to report a cyber fraud."', '"The ' + (v.primary ? v.primary.type.replace('_', ' ') + ' is ' + v.primary.value : 'number or handle is in my message') + '."', '"Money moved at <time>, from <bank>."'].forEach(function (s) { ol.appendChild(el('li', '', s)); });
        callout.appendChild(ol);
        callout.hidden = false;
      } else if (a.id === 'chakshu') {
        var draft = a.text || ('Suspected fraud communication. ' + (v.headline || '') + '. Identifiers: ' + (v.identifiers || []).map(function (i) { return i.type + ' ' + i.value; }).join(', '));
        copyText(draft).then(function () {
          clear(callout);
          callout.appendChild(el('p', '', 'Draft copied. Paste it into the Chakshu form that just opened. JAAL never submits it for you.'));
          callout.hidden = false;
        });
        openUrl(a.href || 'https://sancharsaathi.gov.in/sfc/');
      } else if (a.id === 'share_family') {
        var t = a.text || ((v.headline || '') + ' - checked with JAAL. ' + (v.reason || ''));
        copyText(t).then(function () {
          clear(callout); callout.appendChild(el('p', '', 'Message copied. Paste it in your family group.')); callout.hidden = false;
        });
      } else if (a.href) {
        openUrl(a.href);
      } else if (a.text) {
        copyText(a.text);
      }
    } catch (e) { /* never break the host page */ }
  }

  function openUrl(u) {
    try {
      if (!/^(https?:|tel:|mailto:)/i.test(u)) return;
      root.open(u, '_blank', 'noopener');
    } catch (e) { /* ignore */ }
  }

  /** Download question card. opts: { lang, app, downloadId, onAnswer(yes), onCancel(), onRemove(), onDismiss(), wide } */
  function buildQuestion(q, opts) {
    var o = opts || {};
    var lang = o.lang || 'en';
    var S = Core.strings(lang);
    var v = { state: 'question', surface: 'download', headline: S.dlTitle + ': ' + (q.label || q.app), reason: S.dlQuestion };
    var card = build(v, { lang: lang, wide: o.wide, onDismiss: o.onDismiss, animate: o.animate });
    var pair = el('div', 'jc-actions');
    var yes = el('button', 'jc-btn primary', S.yes);
    var no = el('button', 'jc-btn', S.no);
    yes.type = no.type = 'button';
    pair.appendChild(yes); pair.appendChild(no);
    card.appendChild(pair);
    var body = el('div', 'jc-callout');
    body.hidden = true;
    card.appendChild(body);
    if (q.answer === 'yes') showGuide();
    else if (q.answer === 'no') showNo();
    yes.addEventListener('click', function () { if (o.onAnswer) o.onAnswer(true); showGuide(); });
    no.addEventListener('click', function () { if (o.onAnswer) o.onAnswer(false); showNo(); });
    function showNo() {
      pair.remove();
      clear(body); body.appendChild(el('p', '', S.okNo)); body.hidden = false;
    }
    function showGuide() {
      pair.remove();
      clear(body);
      body.appendChild(el('p', '', S.dlGuideHead));
      var ol = el('ol');
      S.dlGuide.forEach(function (s) { ol.appendChild(el('li', '', s)); });
      body.appendChild(ol);
      body.appendChild(el('span', 'num', '1930'));
      body.hidden = false;
      var acts = el('div', 'jc-actions');
      var c = el('button', 'jc-btn primary', S.cancelDl);
      var r = el('button', 'jc-btn', S.removeDl);
      c.type = r.type = 'button';
      c.addEventListener('click', function () { if (o.onCancel) o.onCancel(); c.disabled = true; c.textContent = '✓ ' + S.cancelDl; });
      r.addEventListener('click', function () { if (o.onRemove) o.onRemove(); r.disabled = true; r.textContent = '✓ ' + S.removeDl; });
      acts.appendChild(c); acts.appendChild(r);
      card.appendChild(acts);
    }
    return card;
  }

  root.JaalCard = { css: CSS, build: build, buildQuestion: buildQuestion, renderRing: renderRing, fallbackRing: fallbackRing, icon: icon, stateChip: stateChip, copyText: copyText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
