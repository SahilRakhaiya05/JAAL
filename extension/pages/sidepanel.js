/* JAAL side panel. */
(function () {
  'use strict';
  var P = globalThis.JaalPage, Core = globalThis.JaalCore, Card = globalThis.JaalCard;
  var $ = function (id) { return document.getElementById(id); };
  var lang = 'en';
  var current = null;      // verdict currently shown
  var history = [];

  if (P.mock) $('mockflag').hidden = false;
  if (P.params.get('tab') === '1') document.title = 'JAAL';

  // ---------- rendering ----------
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function renderEmpty() {
    var host = $('latest'); clear(host);
    var box = P.el('div', 'panel empty');
    box.appendChild(P.el('p', 'quiet', 'Quiet. Nothing reported.'));
    box.appendChild(P.el('p', '', 'JAAL watches chats, pastes, downloads and sites in the background. You will only hear from it when something matches a report.'));
    host.appendChild(box);
    $('more').hidden = true;
    current = null;
  }

  function renderVerdict(v, animate) {
    if (!v) return renderEmpty();
    var host = $('latest'); clear(host);
    current = v;
    if (!Core.shouldShow(v)) {
      var box = P.el('div', 'panel empty');
      box.appendChild(P.el('p', 'quiet', v.headline || 'No reports'));
      box.appendChild(P.el('p', '', 'No report touches this or anything it links to. JAAL says nothing in the page when this happens.'));
      host.appendChild(box);
      $('more').hidden = true;
      return;
    }
    var card = Card.build(v, {
      lang: lang, wide: true, showRing: true, ringSize: 320, showIds: true, animate: animate !== false,
      animateRing: v.state === 'confirmed' && animate !== false,
      onDispute: v.state !== 'local' ? function () { openDispute(); } : null,
      onAction: function (a) {
        if (a.id === 'share_family') { share(); return true; }
        if (a.id === 'dispute') { openDispute(); return true; }
        if (a.id === 'call_1930') { call1930(); return true; }
        return false;
      }
    });
    host.appendChild(card);
    $('more').hidden = false;
    $('a-dispute').hidden = v.state === 'local';
    $('a-out').hidden = true;
  }

  function renderQuestion(q) {
    var host = $('latest'); clear(host);
    current = null;
    $('more').hidden = true;
    host.appendChild(Card.buildQuestion(q, {
      lang: lang, wide: true,
      onAnswer: function (yes) { P.send({ type: 'jaal:dlAnswer', downloadId: q.downloadId, yes: yes }); },
      onCancel: function () { P.send({ type: 'jaal:dlCancel', downloadId: q.downloadId }).then(function (r) { P.toast(r && r.ok === false ? 'Could not cancel: ' + r.error : 'Download cancelled.'); }); },
      onRemove: function () { P.send({ type: 'jaal:dlRemove', downloadId: q.downloadId }).then(function (r) { P.toast(r && r.ok === false ? 'Could not delete: ' + r.error : 'File removed.'); }); }
    }));
  }

  function renderLatest(latest, animate) {
    if (!latest) return renderEmpty();
    if (latest.kind === 'question') return renderQuestion(latest.q);
    return renderVerdict(latest.verdict, animate);
  }

  var ICON = { confirmed: 'octagon', reported: 'triangle', local: 'diamond', question: 'circle', clear: 'check' };

  function renderHistory(list) {
    history = list || [];
    var ul = $('hist'); clear(ul);
    $('hist-empty').hidden = history.length > 0;
    ul.hidden = history.length === 0;
    history.forEach(function (h) {
      var li = P.el('li');
      var b = P.el('button');
      b.type = 'button';
      var ic = P.el('span', 's-' + (h.state || 'clear'));
      ic.appendChild(Card.icon(ICON[h.state] || 'check'));
      var mid = P.el('span');
      mid.style.minWidth = '0';
      mid.appendChild(P.el('div', 'h', h.headline || '(no headline)'));
      mid.appendChild(P.el('div', 'm', Core.stateMeta(h.state, lang).word + ' · ' + Core.surfaceLabel(h.surface)));
      b.appendChild(ic); b.appendChild(mid);
      b.appendChild(P.el('span', 'm', P.ago(h.at)));
      b.setAttribute('aria-label', Core.stateMeta(h.state, lang).word + ': ' + (h.headline || '') + ', ' + P.ago(h.at));
      b.addEventListener('click', function () {
        if (h.state === 'question') P.load('latest').then(function (r) { if (r.latest && r.latest.kind === 'question') renderQuestion(r.latest.q); });
        else renderVerdict(h, true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  // ---------- actions ----------
  function out(nodes) {
    var o = $('a-out'); clear(o);
    nodes.forEach(function (n) { o.appendChild(n); });
    o.hidden = false;
    o.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function action(id) { return ((current && current.actions) || []).filter(function (a) { return a.id === id; })[0]; }

  function chakshuDraft() {
    var a = action('chakshu');
    if (a && a.text) return a.text;
    var v = current || {};
    return 'Suspected fraud communication received via ' + Core.surfaceLabel(v.surface) + '. ' + (v.headline || '') + '. ' +
      (v.reason || '') + ' Identifiers: ' + (v.identifiers || []).map(function (i) { return i.type.replace('_', ' ') + ' ' + i.value; }).join(', ') + '.';
  }

  function chakshu() {
    var draft = chakshuDraft();
    Card.copyText(draft).then(function () { P.toast('Draft copied. Paste it into the Chakshu form.'); });
    var a = action('chakshu');
    window.open((a && a.href) || 'https://sancharsaathi.gov.in/sfc/', '_blank', 'noopener');
    var pre = P.el('p', 'caption', draft);
    out([P.el('b', '', 'Chakshu draft (copied, never auto-submitted)'), pre]);
  }

  function call1930() {
    var v = current || {};
    var box = P.el('div', 'callpanel');
    box.appendChild(P.el('div', 'num', '1930'));
    box.appendChild(P.el('p', 'caption muted', 'National Cyber Crime Helpline, 24x7. Call within the first hour if money moved: banks can freeze it.'));
    var ol = P.el('ol', 'caption');
    ['"I want to report a cyber fraud."',
      v.primary ? '"The ' + v.primary.type.replace('_', ' ') + ' is ' + v.primary.value + '."' : '"The number or handle is ..."',
      '"Money moved at <time> from <bank>, transaction ID <id>."',
      '"I also have screenshots of the messages."'].forEach(function (s) { ol.appendChild(P.el('li', '', s)); });
    box.appendChild(ol);
    var tel = P.el('a', 'btn primary', 'Call 1930');
    tel.href = 'tel:1930';
    tel.style.marginTop = '12px';
    box.appendChild(tel);
    out([box]);
  }

  function shareText() {
    var a = action('share_family');
    if (a && a.text) return a.text;
    var v = current || {};
    return 'JAAL check: ' + (v.headline || '') + '. ' + (v.reason || '') + (v.primary ? ' (' + v.primary.value + ')' : '') + ' If anyone asks you to pay or share an OTP for this, call 1930.';
  }

  function share() {
    var text = shareText();
    Card.copyText(text).then(function () { P.toast('Message copied. Paste it in your family group.'); });
    var nodes = [P.el('b', '', 'Copied for your family group'), P.el('p', 'caption', text)];
    var sa = action('share_family');
    if (sa && sa.href && /^https?:/i.test(sa.href)) {
      var open = P.el('a', 'btn primary', sa.label || 'Send to family');
      open.href = sa.href; open.target = '_blank'; open.rel = 'noopener';
      open.style.marginBottom = '8px';
      nodes.push(open);
    }
    if (current && current.ring) {
      var dl = P.el('button', 'btn', 'Download ring picture (PNG)');
      dl.type = 'button';
      dl.addEventListener('click', function () { ringPng(current.ring).then(function (blobUrl) { var a = document.createElement('a'); a.href = blobUrl; a.download = 'jaal-ring.png'; document.body.appendChild(a); a.click(); a.remove(); }, function () { P.toast('Could not draw the picture.'); }); });
      nodes.push(dl);
    }
    try { if (navigator.share && P.params.get('tab') === '1') { /* tab mode on mobile-ish browsers */ } } catch (e) { /* ignore */ }
    out(nodes);
  }

  /** PNG via shared JaalRing.exportPNG when present, else draw our fallback SVG at 1200x675. */
  function ringPng(ring) {
    return Promise.resolve().then(function () {
      if (globalThis.JaalRing && typeof globalThis.JaalRing.exportPNG === 'function') {
        return Promise.resolve(globalThis.JaalRing.exportPNG(ring, { width: 1200, height: 675, title: (current && current.headline) || undefined, subtitle: (current && current.reason) || undefined, as: 'blob' })).then(toUrl);
      }
      throw new Error('no exporter');
    }).catch(function () { return fallbackPng(ring); });
  }

  function toUrl(r) {
    if (!r) throw new Error('empty');
    if (typeof r === 'string') return r;
    if (r instanceof Blob) return URL.createObjectURL(r);
    if (r.blob instanceof Blob) return URL.createObjectURL(r.blob);
    if (typeof r.dataUrl === 'string') return r.dataUrl;
    if (r.canvas && r.canvas.toDataURL) return r.canvas.toDataURL('image/png');
    if (r.toDataURL) return r.toDataURL('image/png');
    throw new Error('unknown export');
  }

  function fallbackPng(ring) {
    return new Promise(function (resolve, reject) {
      var holder = document.createElement('div');
      Card.fallbackRing(holder, ring, { size: 600, animate: false });
      var svgEl = holder.querySelector('svg');
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgEl.setAttribute('width', '600'); svgEl.setAttribute('height', '600');
      var xml = new XMLSerializer().serializeToString(svgEl);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = 1200; c.height = 675;
        var g = c.getContext('2d');
        g.fillStyle = '#0A0C0F'; g.fillRect(0, 0, 1200, 675);
        g.drawImage(img, 560, 37, 600, 600);
        g.fillStyle = '#F4F3F0'; g.font = '600 44px Inter, system-ui, sans-serif';
        wrapText(g, (current && current.headline) || 'Reported ring', 64, 150, 480, 52);
        g.fillStyle = '#9BA1A8'; g.font = '400 24px Inter, system-ui, sans-serif';
        g.fillText(ring.nodes.length + ' linked identifiers', 64, 330);
        g.fillStyle = '#6E5BFF'; g.font = '600 28px Inter, system-ui, sans-serif';
        g.fillText('JAAL · जाल', 64, 600);
        c.toBlob(function (b) { b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob')); }, 'image/png');
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    });
  }

  function wrapText(g, text, x, y, maxW, lh) {
    var words = String(text).split(' '), line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t;
    });
    if (line) g.fillText(line, x, y);
  }

  function openDispute() {
    var v = current || {};
    var target = v.primary || (v.identifiers && v.identifiers[0]);
    var form = P.el('form', 'dispute-form');
    form.appendChild(P.el('b', '', target ? 'Dispute ' + target.type.replace('_', ' ') + ' ' + target.value : 'Dispute this result'));
    form.appendChild(P.el('p', 'caption muted', 'If this is your number, handle or site and it is not part of a ring, tell us. A dispute demotes it while a person reviews.'));
    var ta = P.el('textarea'); ta.placeholder = 'Why is this wrong?'; ta.required = true; ta.maxLength = 1000; ta.setAttribute('aria-label', 'Reason');
    var contact = P.el('input'); contact.type = 'text'; contact.placeholder = 'Email or phone for follow-up (optional)'; contact.setAttribute('aria-label', 'Contact (optional)');
    var btn = P.el('button', 'btn primary', 'Send dispute'); btn.type = 'submit';
    form.appendChild(ta); form.appendChild(contact); form.appendChild(btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!target) { P.toast('Nothing to dispute here.'); return; }
      btn.disabled = true;
      P.send({ type: 'jaal:dispute', idType: target.type, value: target.value, reason: ta.value, contact: contact.value || undefined }).then(function (r) {
        btn.disabled = false;
        if (r && r.ok) { clear(form); form.appendChild(P.el('b', '', 'Dispute sent')); form.appendChild(P.el('p', 'caption muted', 'Reference ' + (r.disputeId || '') + '. It is demoted while under review.')); }
        else P.toast('Could not reach JAAL. Try again when online.');
      });
    });
    out([form]);
    setTimeout(function () { ta.focus(); }, 50);
  }

  $('a-chakshu').addEventListener('click', chakshu);
  $('a-1930').addEventListener('click', call1930);
  $('a-share').addEventListener('click', share);
  $('a-dispute').addEventListener('click', openDispute);

  // ---------- manual check ----------
  $('manual').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('mtext').value.trim();
    if (!t) { $('mtext').focus(); return; }
    var b = $('mbtn'); b.disabled = true; b.textContent = 'Checking…';
    $('mnote').hidden = true;
    P.send({ type: 'jaal:manual', text: t }).then(function (r) {
      b.disabled = false; b.textContent = 'Check';
      if (r && r.verdict) {
        renderVerdict(r.verdict, true);
        if (r.verdict.local) note('JAAL is offline. This is the on-device pattern check only.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (r && r.offline) {
        note('JAAL could not reach the network, and nothing in this text matches a known scam pattern on this device.');
      } else note('Something went wrong: ' + ((r && r.error) || 'no answer'));
    });
  });
  function note(t) { $('mnote').textContent = t; $('mnote').hidden = false; }

  // ---------- status ----------
  function status() {
    P.send({ type: 'jaal:status' }).then(function (s) {
      var pill = $('net');
      if (!s || s.error) return;
      lang = (s.settings && s.settings.lang) || 'en';
      document.documentElement.lang = lang;
      var on = s.online !== false;
      pill.className = 'pill ' + (on ? 'on' : 'off');
      pill.lastChild.textContent = on ? (s.prefixCount ? s.prefixCount + ' prefixes' : 'Online') : 'On-device only';
      pill.title = on ? 'Connected to the JAAL graph' : 'Graph unreachable: triage still runs on this device';
    });
  }

  // ---------- boot ----------
  if (!P.mock) $('opts').href = P.url('pages/options.html');
  P.load(['latest', 'history']).then(function (r) {
    renderLatest(r.latest, true);
    renderHistory(r.history);
    return P.mock ? null : chrome.storage.session.get('panelIntent');
  }).then(function (r) {
    var intent = r && r.panelIntent;
    if (!intent) return;
    chrome.storage.session.remove('panelIntent');
    if (intent.dispute || intent.action === 'dispute') openDispute();
    else if (intent.action === 'share_family') share();
  }).catch(function () { renderEmpty(); });
  status();
  P.onChange(function (ch) {
    if (ch.latest) renderLatest(ch.latest.newValue, true);
    if (ch.history) renderHistory(ch.history.newValue);
    if (ch.settings || ch.prefixes) status();
  });
})();
