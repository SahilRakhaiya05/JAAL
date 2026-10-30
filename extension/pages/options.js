/* JAAL options page. */
(function () {
  'use strict';
  var P = globalThis.JaalPage, Core = globalThis.JaalCore;
  var $ = function (id) { return document.getElementById(id); };

  if (P.params.get('welcome') === '1') $('welcome').hidden = false;
  globalThis.JaalToggles.mount($('toggles'), P);
  if (Core.API_BASE_PROD) $('useProd').hidden = false;
  if (!P.mock) $('demoLink').href = P.url('demo/index.html');

  function loadSettings() {
    return P.load('settings').then(function (r) {
      var s = Object.assign({}, Core.DEFAULT_SETTINGS, r.settings || {});
      s.rules = Object.assign({}, Core.DEFAULT_SETTINGS.rules, s.rules || {});
      return s;
    });
  }
  function patch(fn) { return loadSettings().then(function (s) { fn(s); return P.save({ settings: s }); }); }

  loadSettings().then(function (s) { $('api').value = s.apiBase; $('lang').value = s.lang; document.documentElement.lang = s.lang; });

  $('lang').addEventListener('change', function () {
    var v = $('lang').value;
    patch(function (s) { s.lang = v; }).then(function () { document.documentElement.lang = v; P.toast('Language saved'); });
  });

  function test() {
    $('apiStatus').textContent = 'Testing…';
    return P.send({ type: 'jaal:ping' }).then(function (r) {
      if (r && r.ok) {
        var h = r.health || {};
        $('apiStatus').textContent = 'Connected' + (h.engine ? ' · engine ' + h.engine : '') + '.';
        P.send({ type: 'jaal:refreshPrefixes' }).then(function (p) { if (p && p.count != null) $('apiStatus').textContent += ' ' + p.count + ' prefixes cached.'; });
      } else $('apiStatus').textContent = 'Not reachable. JAAL keeps working on-device. ' + ((r && r.error) || '');
      status();
    });
  }
  function saveApi(val) {
    var v = Core.normalizeApiBase(val);
    if (!v) { $('apiStatus').textContent = 'Enter a full http(s) URL ending in /api.'; return; }
    $('api').value = v;
    patch(function (s) { s.apiBase = v; }).then(test);
  }
  $('saveApi').addEventListener('click', function () { saveApi($('api').value); });
  $('useLocal').addEventListener('click', function () { saveApi(Core.API_BASE_DEFAULT); });
  $('useProd').addEventListener('click', function () { saveApi(Core.API_BASE_PROD); });

  // ---------- guardian ----------
  $('linkForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('code').value.replace(/\D/g, '');
    if (code.length !== 6) { $('linkStatus').textContent = 'The code has 6 digits.'; $('code').focus(); return; }
    $('linkStatus').textContent = 'Linking…';
    P.send({ type: 'jaal:guardianLink', code: code }).then(function (r) {
      $('linkStatus').textContent = r && r.ok ? 'Linked. You will get a notification if their device hits a confirmed ring.' : 'Could not link: ' + ((r && r.error) || 'check the code');
    });
  });
  $('pair').addEventListener('click', function () {
    $('pairStatus').textContent = 'Asking JAAL…';
    P.send({ type: 'jaal:guardianPair' }).then(function (r) {
      if (r && r.code) { $('myCode').textContent = String(r.code).replace(/(\d{3})(\d{3})/, '$1 $2'); $('pairStatus').textContent = 'Read this code to your guardian.'; }
      else $('pairStatus').textContent = 'Could not get a code: ' + ((r && r.error) || 'offline');
    });
  });

  // ---------- site access (optional host permission for DNR redirect) ----------
  $('hostAccess').addEventListener('click', function () {
    if (P.mock) { $('hostStatus').textContent = 'Granted (mock).'; return; }
    chrome.permissions.request({ origins: ['<all_urls>'] }).then(function (ok) { $('hostStatus').textContent = ok ? 'Granted. Confirmed sites stop before they load.' : 'Not granted. JAAL still redirects right after the page starts.'; status(); });
  });

  function renderBlocked(map) {
    var ul = $('blockedList');
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    var keys = Object.keys(map || {});
    ul.hidden = !keys.length;
    keys.forEach(function (d) {
      var li = P.el('li');
      var b = P.el('button'); b.type = 'button';
      b.appendChild(P.el('span', 's-confirmed', '●'));
      var mid = P.el('span'); mid.appendChild(P.el('div', 'h', d)); mid.appendChild(P.el('div', 'm', map[d].headline || 'Confirmed ring'));
      b.appendChild(mid); b.appendChild(P.el('span', 'm', 'Remove'));
      b.setAttribute('aria-label', 'Stop blocking ' + d);
      b.addEventListener('click', function () { P.send({ type: 'jaal:unblock', domain: d }).then(status); });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  function status() {
    P.send({ type: 'jaal:status' }).then(function (s) {
      if (!s || s.error) return;
      var on = s.online !== false;
      var pill = $('net');
      pill.className = 'pill ' + (on ? 'on' : 'off');
      pill.lastChild.textContent = on ? 'Online' : 'On-device only';
      $('dev').textContent = String(s.deviceHash || '').slice(0, 16) + '…';
      $('hostStatus').textContent = s.hostAccess ? 'Granted.' : '';
      $('hostAccess').hidden = !!s.hostAccess;
      renderBlocked(s.blocked);
      if (s.guardian && s.guardian.code) $('myCode').textContent = String(s.guardian.code).replace(/(\d{3})(\d{3})/, '$1 $2');
      if (s.guardian && s.guardian.linked) $('linkStatus').textContent = 'Linked to a family device.';
    });
  }
  status();
})();
