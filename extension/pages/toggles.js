/* Rule toggles shared by popup and options. */
(function (root) {
  'use strict';
  var RULES = [
    { key: 'pageWatch', title: 'Chat watch', desc: 'WhatsApp Web, Telegram Web, Gmail. Triage runs on this device.' },
    { key: 'domains', title: 'Site check', desc: 'Warns on reported sites, stops confirmed ones.' },
    { key: 'paste', title: 'Paste check', desc: 'Checks a pasted UPI handle, account or wallet before you pay.' },
    { key: 'downloads', title: 'Download watch', desc: 'Asks one question when a remote-access app downloads.' }
  ];

  function mount(container, P) {
    var Core = root.JaalCore;
    P.load('settings').then(function (r) {
      var s = r.settings || Core.DEFAULT_SETTINGS;
      s.rules = Object.assign({}, Core.DEFAULT_SETTINGS.rules, s.rules || {});
      while (container.firstChild) container.removeChild(container.firstChild);
      RULES.forEach(function (rule) {
        var id = 'tg-' + rule.key;
        var row = P.el('div', 'toggle');
        var label = P.el('label');
        label.htmlFor = id;
        label.appendChild(P.el('b', '', rule.title));
        row.appendChild(label);
        var sw = P.el('span', 'switch');
        var input = P.el('input');
        input.type = 'checkbox'; input.id = id; input.checked = s.rules[rule.key] !== false;
        input.setAttribute('role', 'switch');
        input.setAttribute('aria-describedby', id + '-d');
        input.addEventListener('change', function () {
          P.load('settings').then(function (cur) {
            var ns = Object.assign({}, Core.DEFAULT_SETTINGS, cur.settings || {});
            ns.rules = Object.assign({}, Core.DEFAULT_SETTINGS.rules, ns.rules || {});
            ns.rules[rule.key] = input.checked;
            return P.save({ settings: ns });
          }).then(function () { P.toast(rule.title + (input.checked ? ' on' : ' off')); });
        });
        sw.appendChild(input); sw.appendChild(P.el('span'));
        row.appendChild(sw);
        var d = P.el('small', '', rule.desc); d.id = id + '-d';
        row.appendChild(d);
        container.appendChild(row);
      });
    });
  }
  root.JaalToggles = { mount: mount, RULES: RULES };
})(globalThis);
