/*
 * JAAL service worker (MV3, classic). Owns: settings, device identity, hash-prefix cache, graph calls,
 * history, badge, notifications, domain rules (declarativeNetRequest), download watch, guardian polling.
 */
/* global importScripts, JaalExtract, JaalCore */
importScripts('lib/extract.js', 'src/core.js');

var X = JaalExtract, Core = JaalCore;
var BLOCK_RULE_BASE = 1000;     // dynamic redirect rules
var ALLOW_RULE_BASE = 500000;   // session allow rules ("Continue anyway")

// ---------------------------------------------------------------- storage helpers
function get(keys) { return chrome.storage.local.get(keys); }
function set(obj) { return chrome.storage.local.set(obj); }

async function settings() {
  var r = await get('settings');
  var s = r.settings || {};
  var d = Core.DEFAULT_SETTINGS;
  return {
    apiBase: Core.normalizeApiBase(s.apiBase) || d.apiBase,
    lang: s.lang || d.lang,
    rules: Object.assign({}, d.rules, s.rules || {})
  };
}

async function device() {
  var r = await get('device');
  if (r.device && r.device.hash) return r.device;
  var dv = await Core.makeDevice();
  await set({ device: dv });
  return dv;
}

// ---------------------------------------------------------------- network
async function api(path, opts) {
  var s = await settings();
  var o = opts || {};
  var ctrl = new AbortController();
  var to = setTimeout(function () { ctrl.abort(); }, o.timeout || 6000);
  try {
    var res = await fetch(s.apiBase + path, {
      method: o.method || 'GET',
      headers: o.body ? { 'content-type': 'application/json' } : undefined,
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await setOnline(true);
    return await res.json();
  } catch (e) {
    if (e && e.name === 'AbortError' || /Failed to fetch|NetworkError|HTTP 5/.test(String(e && e.message))) await setOnline(false);
    throw e;
  } finally { clearTimeout(to); }
}

async function setOnline(v) {
  var r = await chrome.storage.session.get('online');
  if (r.online !== v) await chrome.storage.session.set({ online: v, onlineAt: Date.now() });
}

// ---------------------------------------------------------------- prefix set (Safe Browsing pattern)
var prefixCache = null; // { set: Set, version, fetchedAt }

async function prefixes(force) {
  if (!prefixCache) {
    var r = await get('prefixes');
    if (r.prefixes && Array.isArray(r.prefixes.list)) prefixCache = { set: new Set(r.prefixes.list), version: r.prefixes.version, fetchedAt: r.prefixes.fetchedAt };
  }
  var stale = !prefixCache || (Date.now() - (prefixCache.fetchedAt || 0) > Core.PREFIX_TTL_MS);
  if (force || stale) {
    try {
      var p = await api('/prefixes', { timeout: 5000 });
      var list = (p && Array.isArray(p.prefixes) ? p.prefixes : []).filter(function (x) { return /^[0-9a-f]{8}$/.test(x); });
      prefixCache = { set: new Set(list), version: p.version, fetchedAt: Date.now() };
      await set({ prefixes: { list: list, version: p.version, fetchedAt: prefixCache.fetchedAt } });
    } catch (e) { /* offline: keep whatever we had */ }
  }
  return prefixCache; // may be null when never fetched
}

async function lookup(ids) {
  var p = await prefixes(false);
  var hashed = await Core.hashIdentifiers(ids);
  var hits = p ? Core.prefixHits(p.set, hashed) : [];
  return { loaded: !!p && p.set.size > 0, hits: hits, hashed: hashed };
}

// ---------------------------------------------------------------- checks
async function graphCheck(body) {
  var s = await settings();
  var dv = await device();
  var payload = Object.assign({ source: 'extension', reporter: dv.hash, lang: s.lang }, body);
  if (payload.text) payload.text = String(payload.text).slice(0, Core.MAX_TEXT);
  var v = await api('/check', { method: 'POST', body: payload, timeout: 7000 });
  if (!v || typeof v.state !== 'string') throw new Error('bad verdict');
  v.surface = body.surface;
  return v;
}

/** Message from a chat surface. Triage is re-run here so the SW is the single gate. */
async function onMessageText(msg, tabId) {
  var s = await settings();
  if (!s.rules.pageWatch) return null;
  var text = Core.normalizeMessageText(msg.text);
  var tri = X.triage(text, {});
  var g = Core.gate(tri);
  if (g === 'drop') return null;
  if (g === 'lookup') {
    var lk = await lookup(tri.identifiers);
    if (Core.afterLookup(lk.hits.length, lk.loaded) === 'drop') return null;
  }
  var v;
  try {
    v = await graphCheck({ text: text, surface: msg.surface, context: { unknownSender: undefined } });
  } catch (e) {
    if (tri.level !== 'trigger') return null;           // low-signal + offline = silence
    v = Core.localVerdict(tri, msg.surface, s.lang);
  }
  await deliver(v, tabId, { snippet: Core.clampText(text, 140) });
  return v;
}

async function onPaste(msg, tabId) {
  var s = await settings();
  if (!s.rules.paste) return null;
  var ids = (msg.identifiers || []).filter(function (x) { return x && /^(upi|bank_account|crypto)$/.test(x.type) && typeof x.value === 'string'; }).slice(0, 3);
  var lk = await lookup(ids);
  if (Core.pasteDecision(ids.length, lk.hits.length, lk.loaded) === 'drop') return null;
  var v;
  try {
    v = await graphCheck({ identifiers: ids, surface: 'paste', context: { firstTimePayee: true } });
  } catch (e) { return null; }                          // a bare handle has no on-device pattern signal
  await deliver(v, tabId, { anchor: msg.anchor, snippet: ids.map(function (i) { return i.value; }).join(', ') });
  return v;
}

async function onManual(text) {
  var s = await settings();
  var t = String(text || '').slice(0, Core.MAX_TEXT);
  var tri = X.triage(t, {});
  var v;
  try {
    v = await graphCheck({ text: t, surface: 'manual' });
  } catch (e) {
    if (tri.triggers.length) v = Core.localVerdict(tri, 'manual', s.lang);
    else return { verdict: null, offline: true, triage: { level: tri.level, score: tri.score } };
  }
  await deliver(v, null, { snippet: Core.clampText(t, 140), quiet: true });
  return { verdict: v };
}

// ---------------------------------------------------------------- delivery
async function deliver(v, tabId, extra) {
  var e = extra || {};
  v.at = new Date().toISOString();
  v.snippet = e.snippet || '';
  var r = await get(['history']);
  await set({ history: Core.pushHistory(r.history, slim(v)) });
  if (!Core.shouldShow(v)) return;
  await set({ latest: { kind: 'verdict', verdict: v } });
  if (tabId != null) {
    setBadge(tabId, v);
    if (!e.quiet) chrome.tabs.sendMessage(tabId, { type: 'jaal:show', verdict: v, anchor: e.anchor || null }, { frameId: 0 }).catch(function () {});
  }
  if (v.state === 'confirmed' && !e.quiet) {
    notify('jaal-v-' + v.id, Core.stateMeta('confirmed').word, v.headline, v.reason);
    guardianAlert(v).catch(function () {});
  }
}

function slim(v) {
  return {
    id: v.id, state: v.state, headline: v.headline, reason: v.reason, surface: v.surface, at: v.at, snippet: v.snippet,
    primary: v.primary, stats: v.stats, campaign: v.campaign, ring: v.ring, signals: v.signals, actions: v.actions,
    identifiers: (v.identifiers || []).slice(0, 8), local: !!v.local, engine: v.engine
  };
}

function setBadge(tabId, v) {
  try {
    var b = Core.badgeFor(v.state, v.stats && v.stats.reports);
    chrome.action.setBadgeText({ tabId: tabId, text: b.text }).catch(function () {});
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: b.color }).catch(function () {});
    if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ tabId: tabId, color: v.state === 'reported' ? '#0A0C0F' : '#FFFFFF' }).catch(function () {});
    chrome.action.setTitle({ tabId: tabId, title: 'JAAL - ' + Core.stateMeta(v.state).word + ': ' + v.headline }).catch(function () {});
  } catch (e) { /* ignore */ }
}

function notify(id, title, message, context, buttons) {
  try {
    var opts = { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title: 'JAAL · ' + title, message: message || '', contextMessage: Core.clampText(context || '', 120), priority: 2 };
    if (buttons) opts.buttons = buttons;
    chrome.notifications.create(id, opts).catch(function () {});
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- side panel
async function openPanel(windowId, tabId) {
  try {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      if (tabId != null) await chrome.sidePanel.open({ tabId: tabId });
      else await chrome.sidePanel.open({ windowId: windowId });
      return true;
    }
  } catch (e) { /* not in a user gesture: fall back */ }
  await chrome.tabs.create({ url: chrome.runtime.getURL('pages/sidepanel.html?tab=1') });
  return false;
}

async function focusedWindowId() {
  try { var w = await chrome.windows.getLastFocused(); return w.id; } catch (e) { return undefined; }
}

// ---------------------------------------------------------------- domain check + rules
function hostDomain(url) {
  try {
    var u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    var host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.indexOf('.') === -1) return null;
    return { host: host, domain: X.registrable(host) };
  } catch (e) { return null; }
}

async function allowed(domain) {
  var r = await chrome.storage.session.get('allow');
  return !!(r.allow && r.allow[domain]);
}

async function blockedMap() { var r = await get('blocked'); return r.blocked || {}; }

function blockedUrl(domain, url, vid, committed) {
  return chrome.runtime.getURL('pages/blocked.html') + '?' + (committed ? 'via=tab&' : '') + 'd=' + encodeURIComponent(domain) + (vid ? '&v=' + encodeURIComponent(vid) : '') + (url ? '#' + url : '');
}

async function hasHostAccess() {
  try { return await chrome.permissions.contains({ origins: ['<all_urls>'] }); } catch (e) { return false; }
}

async function addBlockRule(domain, v) {
  var map = await blockedMap();
  if (map[domain]) return map[domain].ruleId;
  var ids = Object.keys(map).map(function (k) { return map[k].ruleId; });
  var ruleId = BLOCK_RULE_BASE + (ids.length ? Math.max.apply(null, ids) - BLOCK_RULE_BASE + 1 : 0);
  var esc = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [{
      id: ruleId,
      priority: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: chrome.runtime.getURL('pages/blocked.html') + '?d=' + encodeURIComponent(domain) + '#\\0' } },
      condition: { regexFilter: '^https?://([^/]*\\.)?' + esc + '([:/?#].*)?$', resourceTypes: ['main_frame'] }
    }]
  });
  map[domain] = { ruleId: ruleId, headline: v && v.headline, verdictId: v && v.id, at: new Date().toISOString() };
  await set({ blocked: map });
  return ruleId;
}

async function allowSession(domain) {
  var r = await chrome.storage.session.get(['allow', 'allowSeq']);
  var allow = r.allow || {};
  var seq = (r.allowSeq || 0) + 1;
  var id = ALLOW_RULE_BASE + seq;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{ id: id, priority: 10, action: { type: 'allow' }, condition: { requestDomains: [domain], resourceTypes: ['main_frame'] } }]
  });
  allow[domain] = id;
  await chrome.storage.session.set({ allow: allow, allowSeq: seq });
}

var navState = new Map(); // tabId -> { url, committed, completed, pending }

/**
 * Runs on onBeforeNavigate, so it also catches scam domains that do not resolve.
 * Hash + prefix lookup is local; only a prefix hit sends the domain to the graph.
 */
async function onBeforeNav(details) {
  if (details.frameId !== 0) return;
  var hd = hostDomain(details.url);
  if (!hd) return;
  var st = { url: details.url, committed: false, completed: false, pending: null };
  navState.set(details.tabId, st);
  if (await allowed(hd.domain)) return;
  var map = await blockedMap();
  if (map[hd.domain]) {
    // With optional host access the DNR redirect already fired; without it, redirect here.
    if (!(await hasHostAccess())) chrome.tabs.update(details.tabId, { url: blockedUrl(hd.domain, details.url, map[hd.domain].verdictId, st.committed) }).catch(function () {});
    return;
  }
  var s = await settings();
  if (!s.rules.domains) return;
  var n = X.normUrl(details.url);
  var ids = [{ type: 'domain', value: hd.domain }];
  if (hd.host !== hd.domain) ids.push({ type: 'domain', value: hd.host });
  if (n) ids.push({ type: 'url', value: n.url });
  var lk = await lookup(ids);
  if (!lk.hits.length) return;                       // nothing leaves the device for unknown domains
  var v;
  try { v = await graphCheck({ identifiers: ids.filter(function (i) { return i.type === 'domain'; }), surface: 'page', context: { url: hd.host } }); } catch (e) { return; }
  if (navState.get(details.tabId) !== st) return;    // user already moved on
  if (v.state === 'confirmed') {
    await addBlockRule(hd.domain, v);
    await deliver(v, details.tabId, { snippet: hd.host, quiet: true });
    chrome.tabs.update(details.tabId, { url: blockedUrl(hd.domain, details.url, v.id, st.committed) }).catch(function () {});
    notify('jaal-v-' + v.id, Core.stateMeta('confirmed').word, v.headline, hd.host);
  } else if (Core.shouldShow(v)) {
    if (st.completed) await deliver(v, details.tabId, { snippet: hd.host });
    else st.pending = v;                              // content script not ready yet: show on onCompleted
  } else {
    await deliver(v, details.tabId, { snippet: hd.host, quiet: true });
  }
}

function onCommitted(details) {
  if (details.frameId !== 0) return;
  var st = navState.get(details.tabId);
  if (st) st.committed = true;
}

async function onNavCompleted(details) {
  if (details.frameId !== 0) return;
  var st = navState.get(details.tabId);
  if (!st) return;
  st.completed = true;
  if (st.pending) { var v = st.pending; st.pending = null; await deliver(v, details.tabId, { snippet: (hostDomain(details.url) || {}).host }); }
}

// ---------------------------------------------------------------- downloads
async function onDownload(item) {
  var s = await settings();
  if (!s.rules.downloads) return;
  var m = Core.matchRemoteApp(item.filename || '', [item.finalUrl, item.url]);
  if (!m) return;
  var r = await chrome.storage.session.get('dlFlagged');
  var flagged = r.dlFlagged || {};
  if (flagged[item.id]) return;
  flagged[item.id] = true;
  await chrome.storage.session.set({ dlFlagged: flagged });
  var q = { downloadId: item.id, app: m.id, label: m.label, filename: (item.filename || '').split(/[\\/]/).pop(), at: new Date().toISOString(), answer: null };
  await set({ latest: { kind: 'question', q: q } });
  var h = await get('history');
  await set({ history: Core.pushHistory(h.history, { id: 'dl-' + item.id, state: 'question', headline: 'Remote-access app: ' + m.label, reason: Core.strings(s.lang).dlQuestion, surface: 'download', at: q.at, snippet: q.filename }) });
  var S = Core.strings(s.lang);
  notify('jaal-dl-' + item.id, S.dlTitle, m.label + ' - ' + S.dlQuestion, q.filename, [{ title: S.yes }, { title: S.no }]);
  try {
    var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs[0]) {
      chrome.action.setBadgeText({ tabId: tabs[0].id, text: '?' }).catch(function () {});
      chrome.action.setBadgeBackgroundColor({ tabId: tabs[0].id, color: '#6E5BFF' }).catch(function () {});
      chrome.tabs.sendMessage(tabs[0].id, { type: 'jaal:question', q: q }, { frameId: 0 }).catch(function () {});
    }
  } catch (e) { /* ignore */ }
}

async function dlAnswer(id, yes) {
  var r = await get('latest');
  if (r.latest && r.latest.kind === 'question' && r.latest.q.downloadId === id) {
    r.latest.q.answer = yes ? 'yes' : 'no';
    await set({ latest: r.latest });
  }
}

async function dlCancel(id) {
  try {
    var items = await chrome.downloads.search({ id: id });
    if (items[0] && items[0].state === 'in_progress') await chrome.downloads.cancel(id);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

async function dlRemove(id) {
  try {
    var items = await chrome.downloads.search({ id: id });
    if (!items[0]) return { ok: false, error: 'not found' };
    if (items[0].state === 'in_progress') await chrome.downloads.cancel(id);
    else if (items[0].state === 'complete' && items[0].exists) await chrome.downloads.removeFile(id);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// ---------------------------------------------------------------- guardian
async function guardianAlert(v) {
  var r = await get('guardian');
  if (!r.guardian || !r.guardian.protected) return;
  var dv = await device();
  await api('/guardian/alert', { method: 'POST', body: { deviceHash: dv.hash, verdictId: v.id } });
}

async function guardianPoll() {
  var r = await get(['guardian']);
  var g = r.guardian || {};
  if (!g.linked) return;
  var dv = await device();
  var list;
  try { list = await api('/guardian/alerts?guardianHash=' + encodeURIComponent(dv.hash)); } catch (e) { return; }
  var lastAt = g.lastAlertAt || '';
  var fresh = (Array.isArray(list) ? list : []).filter(function (a) { return a && a.at > lastAt; });
  fresh.slice(0, 3).forEach(function (a) {
    var v = a.verdict || {};
    notify('jaal-g-' + (v.id || a.at), 'Family alert', v.headline || 'A family device hit a confirmed ring', 'From your linked family device');
  });
  if (fresh.length) { g.lastAlertAt = fresh.map(function (a) { return a.at; }).sort().pop(); await set({ guardian: g }); }
}

// ---------------------------------------------------------------- wiring
async function setupActionBehaviour() {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      await chrome.action.setPopup({ popup: '' });
    } else {
      await chrome.action.setPopup({ popup: 'pages/popup.html' });
    }
  } catch (e) { try { await chrome.action.setPopup({ popup: 'pages/popup.html' }); } catch (e2) { /* ignore */ } }
}

chrome.runtime.onInstalled.addListener(function (details) {
  (async function () {
    try {
      var r = await get('settings');
      if (!r.settings) await set({ settings: Core.DEFAULT_SETTINGS });
      await device();
      await setupActionBehaviour();
      chrome.alarms.create('prefixes', { periodInMinutes: 30, delayInMinutes: 0.1 });
      chrome.alarms.create('guardian', { periodInMinutes: 5 });
      if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('pages/options.html?welcome=1') }).catch(function () {});
    } catch (e) { console.warn('[jaal] install setup', e); }
  })();
});

chrome.runtime.onStartup.addListener(function () {
  setupActionBehaviour();
  prefixes(false).catch(function () {});
});

chrome.alarms.onAlarm.addListener(function (a) {
  if (a.name === 'prefixes') prefixes(true).catch(function () {});
  if (a.name === 'guardian') guardianPoll().catch(function () {});
});

chrome.webNavigation.onCompleted.addListener(function (d) { onNavCompleted(d).catch(function (e) { console.warn('[jaal] nav', e); }); });
chrome.webNavigation.onBeforeNavigate.addListener(function (d) { onBeforeNav(d).catch(function (e) { console.warn('[jaal] nav', e); }); });
chrome.webNavigation.onCommitted.addListener(onCommitted);

chrome.downloads.onCreated.addListener(function (item) { onDownload(item).catch(function (e) { console.warn('[jaal] dl', e); }); });
chrome.downloads.onChanged.addListener(function (delta) {
  if (!delta.filename || !delta.filename.current) return;
  chrome.downloads.search({ id: delta.id }).then(function (items) { if (items[0]) return onDownload(items[0]); }).catch(function () {});
});

chrome.notifications.onClicked.addListener(function (id) {
  focusedWindowId().then(function (w) { return openPanel(w); }).catch(function () {});
  chrome.notifications.clear(id);
});
chrome.notifications.onButtonClicked.addListener(function (id, idx) {
  var m = /^jaal-dl-(\d+)$/.exec(id);
  if (!m) return;
  var dlId = Number(m[1]);
  dlAnswer(dlId, idx === 0).then(function () { return focusedWindowId(); }).then(function (w) { if (idx === 0) return openPanel(w); }).catch(function () {});
  chrome.notifications.clear(id);
});

chrome.tabs.onRemoved.addListener(function (tabId) { navState.delete(tabId); });

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string') return false;
  var tabId = sender.tab ? sender.tab.id : null;
  // sidePanel.open must run inside the user gesture: call it before any await.
  if (msg.type === 'jaal:openPanel') {
    var p = (chrome.sidePanel && chrome.sidePanel.open && tabId != null)
      ? chrome.sidePanel.open({ tabId: tabId })
      : Promise.reject(new Error('no side panel'));
    p.then(function () { return true; }, function () { return chrome.tabs.create({ url: chrome.runtime.getURL('pages/sidepanel.html?tab=1') }); })
      .then(function () { if (msg.dispute || msg.action) return chrome.storage.session.set({ panelIntent: { verdictId: msg.verdictId, dispute: !!msg.dispute, action: msg.action || null } }); })
      .then(function () { sendResponse({ ok: true }); }, function () { sendResponse({ ok: false }); });
    return true;
  }
  var handlers = {
    'jaal:message': function () { return onMessageText(msg, tabId).then(function (v) { return { verdict: v }; }); },
    'jaal:paste': function () { return onPaste(msg, tabId).then(function (v) { return { verdict: v }; }); },
    'jaal:manual': function () { return onManual(msg.text); },
    'jaal:dlAnswer': function () { return dlAnswer(msg.downloadId, !!msg.yes).then(function () { return { ok: true }; }); },
    'jaal:dlCancel': function () { return dlCancel(msg.downloadId); },
    'jaal:dlRemove': function () { return dlRemove(msg.downloadId); },
    'jaal:status': async function () {
      var s = await settings(); var p = await prefixes(false); var o = await chrome.storage.session.get(['online']);
      var dv = await device(); var g = await get('guardian'); var b = await blockedMap();
      return { settings: s, prefixCount: p ? p.set.size : 0, prefixVersion: p && p.version, fetchedAt: p && p.fetchedAt, online: o.online, deviceHash: dv.hash, guardian: g.guardian || {}, blocked: b, hostAccess: await hasHostAccess(), sidePanel: !!chrome.sidePanel };
    },
    'jaal:ping': async function () {
      try { var h = await api('/health', { timeout: 4000 }); return { ok: true, health: h }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    },
    'jaal:refreshPrefixes': async function () { var p = await prefixes(true); return { count: p ? p.set.size : 0 }; },
    'jaal:dispute': async function () {
      return api('/dispute', { method: 'POST', body: { type: msg.idType, value: msg.value, reason: String(msg.reason || '').slice(0, 1000), contact: msg.contact || undefined } });
    },
    'jaal:report': async function () {
      var dv = await device(); var s = await settings();
      return api('/report', { method: 'POST', body: { text: String(msg.text || '').slice(0, Core.MAX_TEXT), reporter: dv.hash, verdict: msg.verdict === 'safe' ? 'safe' : 'scam', lang: s.lang } });
    },
    'jaal:guardianLink': async function () {
      var dv = await device();
      var res = await api('/guardian/link', { method: 'POST', body: { code: String(msg.code || '').replace(/\D/g, '').slice(0, 6), guardianHash: dv.hash } });
      if (res && res.ok) { var g = (await get('guardian')).guardian || {}; g.linked = true; g.linkedAt = new Date().toISOString(); await set({ guardian: g }); }
      return res;
    },
    'jaal:guardianPair': async function () {
      var dv = await device();
      var res = await api('/guardian/pair', { method: 'POST', body: { deviceHash: dv.hash } });
      if (res && res.code) { var g = (await get('guardian')).guardian || {}; g.protected = true; g.code = res.code; await set({ guardian: g }); }
      return res;
    },
    'jaal:allow': async function () {
      var d = String(msg.domain || '');
      if (!d) return { ok: false };
      await allowSession(d);
      return { ok: true };
    },
    'jaal:unblock': async function () {
      var map = await blockedMap(); var d = String(msg.domain || '');
      if (map[d]) { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [map[d].ruleId] }); delete map[d]; await set({ blocked: map }); }
      return { ok: true };
    },
    'jaal:setupAction': async function () { await setupActionBehaviour(); return { ok: true }; }
  };
  var h = handlers[msg.type];
  if (!h) return false;
  Promise.resolve().then(h).then(function (r) { sendResponse(r); }, function (e) { sendResponse({ error: String(e && e.message || e) }); });
  return true;
});
