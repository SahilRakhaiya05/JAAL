/* Fallback popup (used when chrome.sidePanel is unavailable). */
(function () {
  'use strict';
  var P = globalThis.JaalPage;
  globalThis.JaalToggles.mount(document.getElementById('toggles'), P);

  P.send({ type: 'jaal:status' }).then(function (s) {
    if (!s || s.error) return;
    var on = s.online !== false;
    var pill = document.getElementById('net');
    pill.className = 'pill ' + (on ? 'on' : 'off');
    pill.lastChild.textContent = on ? 'Online' : 'On-device only';
    var n = Object.keys(s.blocked || {}).length;
    document.getElementById('summary').textContent = (s.prefixCount || 0) + ' reported prefixes cached' + (n ? ' · ' + n + ' sites stopped' : '') + '. Nothing leaves this device unless it matches.';
  });

  document.getElementById('open').addEventListener('click', function () {
    if (P.mock) { location.href = 'sidepanel.html?mock=1'; return; }
    var go = chrome.sidePanel && chrome.sidePanel.open
      ? chrome.windows.getCurrent().then(function (w) { return chrome.sidePanel.open({ windowId: w.id }); })
      : Promise.reject(new Error('no side panel'));
    go.then(function () { window.close(); }, function () { chrome.tabs.create({ url: P.url('pages/sidepanel.html?tab=1') }); window.close(); });
  });
  document.getElementById('settings').addEventListener('click', function () {
    if (P.mock) { location.href = 'options.html?mock=1'; return; }
    chrome.runtime.openOptionsPage();
    window.close();
  });
})();
