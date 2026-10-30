/* Shared helpers for extension pages. Tolerates a missing chrome object (?mock=1, file://, preview). */
(function (root) {
  'use strict';
  var params = new URLSearchParams(location.search);
  var hasChrome = false;
  try { hasChrome = !!(root.chrome && chrome.runtime && chrome.runtime.id && chrome.storage); } catch (e) { hasChrome = false; }
  var mock = params.get('mock') === '1' || !hasChrome;
  var mem = {};

  // VerdictCard styles (the overlay puts the same CSS inside its shadow root).
  if (root.JaalCard && !document.getElementById('jc-css')) {
    var st = document.createElement('style');
    st.id = 'jc-css';
    st.textContent = root.JaalCard.css;
    document.head.appendChild(st);
  }

  function mockReply(msg) {
    var M = root.JaalMock || {};
    switch (msg.type) {
      case 'jaal:status': return { settings: root.JaalCore.DEFAULT_SETTINGS, prefixCount: 1284, prefixVersion: 'mock', fetchedAt: Date.now() - 6e5, online: true, deviceHash: 'mock-3f9a1c', guardian: {}, blocked: {}, hostAccess: false, sidePanel: true };
      case 'jaal:manual': {
        var tri = root.JaalExtract.triage(msg.text || '', {});
        if (tri.level === 'ignore') return { verdict: { id: 'm-clear', state: 'clear', headline: 'No reports for this message', reason: '', surface: 'manual', actions: [] } };
        return { verdict: tri.level === 'trigger' ? M.confirmed : M.reported };
      }
      case 'jaal:ping': return { ok: true, health: { ok: true, engine: 'memory' } };
      case 'jaal:guardianPair': return { code: '482913' };
      case 'jaal:guardianLink': return { ok: true };
      case 'jaal:dispute': return { ok: true, disputeId: 'mock-d1' };
      case 'jaal:refreshPrefixes': return { count: 1284 };
      default: return { ok: true };
    }
  }

  function send(msg) {
    if (mock) return new Promise(function (r) { setTimeout(function () { r(mockReply(msg)); }, 180); });
    return chrome.runtime.sendMessage(msg).catch(function (e) { return { error: String(e && e.message || e) }; });
  }

  function load(keys) {
    if (mock) {
      var M = root.JaalMock || {};
      var base = { settings: root.JaalCore.DEFAULT_SETTINGS, history: M.history || [], latest: params.get('q') === '1' ? { kind: 'question', q: M.question } : { kind: 'verdict', verdict: params.get('state') === 'reported' ? M.reported : params.get('state') === 'local' ? M.local : M.confirmed } };
      var out = {};
      [].concat(keys).forEach(function (k) { out[k] = k in mem ? mem[k] : base[k]; });
      return Promise.resolve(out);
    }
    return chrome.storage.local.get(keys);
  }

  function save(obj) {
    if (mock) { Object.assign(mem, obj); return Promise.resolve(); }
    return chrome.storage.local.set(obj);
  }

  function onChange(fn) {
    if (mock) return;
    try { chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local') fn(ch); }); } catch (e) { /* ignore */ }
  }

  function url(path) { return mock ? path.replace(/^pages\//, '') : chrome.runtime.getURL(path); }

  var toastTimer = null;
  function toast(text) {
    var t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function ago(iso) {
    if (!iso) return '';
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  root.JaalPage = { mock: mock, params: params, send: send, load: load, save: save, onChange: onChange, url: url, toast: toast, ago: ago, el: el };
})(globalThis);
