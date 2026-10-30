/* JAAL warning page for confirmed-ring domains (redirect target). */
(function () {
  'use strict';
  var P = globalThis.JaalPage, Core = globalThis.JaalCore, Card = globalThis.JaalCard;
  var domain = P.params.get('d') || (P.mock ? 'kyc-update-bank.top' : '');
  var vid = P.params.get('v');
  var original = decodeURIComponent(location.hash.slice(1) || '') || (domain ? 'https://' + domain + '/' : '');
  if (!/^https?:\/\//i.test(original)) original = domain ? 'https://' + domain + '/' : '';

  function render(v) {
    var host = document.getElementById('cardhost');
    while (host.firstChild) host.removeChild(host.firstChild);
    var card = Card.build(v, { wide: true, showRing: true, ringSize: 320, lang: v.lang || 'en' });
    var d = P.el('p', 'domain', original || domain);
    card.insertBefore(d, card.children[1]);
    host.appendChild(card);
  }

  var base = {
    id: vid || 'blocked', state: 'confirmed', surface: 'page',
    headline: 'This site is linked to a confirmed ring',
    reason: 'People reported it in scam messages. JAAL stopped it before anything loaded.',
    ring: null, actions: []
  };

  P.load(['blocked', 'history', 'settings']).then(function (r) {
    var entry = (r.blocked || {})[domain];
    var hist = (r.history || []).filter(function (h) { return (vid && h.id === vid) || (entry && h.id === entry.verdictId); })[0];
    var v = Object.assign({}, base, hist || {}, { surface: 'page', state: 'confirmed', actions: [] });
    if (entry && entry.headline && !hist) v.headline = entry.headline;
    if (P.mock && !hist) { v = Object.assign({}, globalThis.JaalMock.confirmed, { surface: 'page', actions: [], headline: '38 people reported this site', reason: 'It imitates a bank KYC page and is 1 hop from a confirmed ring of 23 identifiers.' }); }
    v.lang = (r.settings && r.settings.lang) || 'en';
    render(v);
  }).catch(function () { render(base); });

  document.getElementById('back').addEventListener('click', function () {
    // via=tab: the scam page committed before we replaced it, so it sits one entry back.
    var steps = P.params.get('via') === 'tab' ? 2 : 1;
    if (history.length > steps) history.go(-steps);
    else location.replace('about:blank');
  });
  document.getElementById('cont').addEventListener('click', function () {
    if (!domain || !original) return;
    P.send({ type: 'jaal:allow', domain: domain }).then(function () { location.replace(original); });
  });
  document.getElementById('dispute').addEventListener('click', function (e) {
    e.preventDefault();
    var reason = prompt('Why is ' + domain + ' not part of a scam ring?');
    if (!reason) return;
    P.send({ type: 'jaal:dispute', idType: 'domain', value: domain, reason: reason }).then(function (r) { P.toast(r && r.ok ? 'Dispute sent. The site is demoted while a person reviews.' : 'Could not reach JAAL.'); });
  });
})();
