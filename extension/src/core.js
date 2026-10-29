/*
 * JAAL extension core: pure logic shared by the service worker, content scripts,
 * extension pages and node:test. No DOM, no chrome.* here.
 * Classic script (sets globalThis.JaalCore) + CommonJS (module.exports) for tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JaalCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- config ----------
  var API_BASE_DEFAULT = 'http://localhost:8787/api';
  // Production base. Set at release time; the options page offers it as a one-click preset when non-empty.
  var API_BASE_PROD = ''; // e.g. 'https://<your-deploy>/api'
  var PREFIX_TTL_MS = 30 * 60 * 1000;
  var HISTORY_MAX = 20;
  var MAX_TEXT = 2000;

  var DEFAULT_SETTINGS = {
    apiBase: API_BASE_DEFAULT,
    lang: 'en',
    rules: { pageWatch: true, domains: true, paste: true, downloads: true }
  };

  // ---------- hashing ----------
  function subtle() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (!c || !c.subtle) throw new Error('crypto.subtle unavailable');
    return c.subtle;
  }

  function toHex(buf) {
    var b = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }

  function sha256Hex(str) {
    var data = new TextEncoder().encode(String(str));
    return subtle().digest('SHA-256', data).then(toHex);
  }

  /** identifiers [{type,value}] -> Promise<[{type,value,key,hash,prefix}]> */
  function hashIdentifiers(ids) {
    return Promise.all((ids || []).map(function (x) {
      var key = x.type + ':' + x.value;
      return sha256Hex(key).then(function (h) {
        return { type: x.type, value: x.value, key: key, hash: h, prefix: h.slice(0, 8) };
      });
    }));
  }

  /** prefixList: array or Set of 8-hex strings. Returns the hashed identifiers that hit. */
  function prefixHits(prefixList, hashed) {
    if (!prefixList) return [];
    var set = prefixList instanceof Set ? prefixList : new Set(prefixList);
    return (hashed || []).filter(function (h) { return set.has(h.prefix); });
  }

  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(a);
    return toHex(a.buffer);
  }

  /** Device identity: random 32-byte id + on-device salt. Only sha256(salt:id) ever leaves the device. */
  function makeDevice() {
    var id = randomHex(32);
    var salt = randomHex(16);
    return sha256Hex(salt + ':' + id).then(function (hash) {
      return { id: id, salt: salt, hash: hash, createdAt: new Date().toISOString() };
    });
  }

  // ---------- gating ----------
  /**
   * First gate, straight from triage level:
   *   'drop'   - never leaves the device
   *   'lookup' - consult the local hash-prefix set first
   *   'check'  - strong signal, ask the graph
   */
  function gate(tri) {
    if (!tri || tri.level === 'ignore') return 'drop';
    if (tri.level === 'trigger') return 'check';
    return 'lookup';
  }

  /** Second gate after a prefix lookup. prefixesLoaded=false means we have no list (offline / first run). */
  function afterLookup(hitCount, prefixesLoaded) {
    if (hitCount > 0) return 'check';
    return 'drop';
  }

  /** Paste gate: only payables. Prefix hit -> check; no list at all -> check (fail open to the graph). */
  function pasteDecision(payableCount, hitCount, prefixesLoaded) {
    if (!payableCount) return 'drop';
    if (hitCount > 0) return 'check';
    if (!prefixesLoaded) return 'check';
    return 'drop';
  }

  function payables(ids) {
    return (ids || []).filter(function (x) { return x.type === 'upi' || x.type === 'bank_account' || x.type === 'crypto'; });
  }

  // ---------- remote-access installer matcher ----------
  var REMOTE = [
    { id: 'quicksupport', label: 'TeamViewer QuickSupport', names: ['quicksupport', 'teamviewerqs', 'tvqs'], hosts: [] },
    { id: 'anydesk', label: 'AnyDesk', names: ['anydesk'], hosts: ['anydesk.com'] },
    { id: 'teamviewer', label: 'TeamViewer', names: ['teamviewer'], hosts: ['teamviewer.com'] },
    { id: 'airdroid', label: 'AirDroid', names: ['airdroid'], hosts: ['airdroid.com'] },
    { id: 'rustdesk', label: 'RustDesk', names: ['rustdesk'], hosts: ['rustdesk.com'] },
    { id: 'ultraviewer', label: 'UltraViewer', names: ['ultraviewer'], hosts: ['ultraviewer.net'] }
  ];
  var INSTALLER_EXT = /\.(exe|msi|msix|apk|aab|xapk|dmg|pkg|deb|rpm|appimage|zip|bin|run)$/i;

  function basename(p) {
    var s = String(p || '').split(/[\\/]/).pop() || '';
    return s.split('?')[0].split('#')[0];
  }

  function hostOf(u) {
    try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  /**
   * filename: local path or name ('' allowed); urls: download url / finalUrl.
   * Returns { id, label, by: 'filename'|'url' } or null.
   */
  function matchRemoteApp(filename, urls) {
    var list = Array.isArray(urls) ? urls : [urls];
    var candidates = [basename(filename)];
    list.forEach(function (u) { if (u) candidates.push(basename(safeDecode(pathOf(u)))); });
    for (var c = 0; c < candidates.length; c++) {
      var name = candidates[c];
      if (!name) continue;
      var hasExt = /\.[a-z0-9]{1,8}$/i.test(name);
      if (hasExt && !INSTALLER_EXT.test(name)) continue;
      var squashed = name.toLowerCase().replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[^a-z]/g, '');
      for (var i = 0; i < REMOTE.length; i++) {
        for (var j = 0; j < REMOTE[i].names.length; j++) {
          if (squashed.indexOf(REMOTE[i].names[j]) !== -1) return { id: REMOTE[i].id, label: REMOTE[i].label, by: 'filename' };
        }
      }
    }
    for (var k = 0; k < list.length; k++) {
      var h = hostOf(list[k]);
      if (!h) continue;
      for (var r = 0; r < REMOTE.length; r++) {
        for (var q = 0; q < REMOTE[r].hosts.length; q++) {
          var host = REMOTE[r].hosts[q];
          if (h === host || h.slice(-host.length - 1) === '.' + host) return { id: REMOTE[r].id, label: REMOTE[r].label, by: 'url' };
        }
      }
    }
    return null;
  }

  function pathOf(u) { try { return new URL(u).pathname; } catch (e) { return ''; } }
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // ---------- message node helpers ----------
  /**
   * Decide whether a message node descriptor is the user's own outgoing message.
   * d = { className, dataId, testid, ariaLabel, ancestorClassNames } (all strings, optional)
   */
  function isOutgoing(d) {
    if (!d) return false;
    var cls = ' ' + String(d.className || '') + ' ' + String(d.ancestorClassNames || '') + ' ';
    if (/(^|\s)(message-out|is-out|own|outgoing|msg-out|from-me)(\s|$)/.test(cls)) return true;
    if (/^true_/.test(String(d.dataId || ''))) return true; // WhatsApp Web: data-id="true_<chat>_<msg>" = sent by me
    if (/(^|-)out(-|$)|outgoing|msg-out/i.test(String(d.testid || ''))) return true;
    if (/^(you|you said|sent by you)\b/i.test(String(d.ariaLabel || '').trim())) return true;
    if (String(d.direction || '') === 'out') return true;
    return false;
  }

  var TIME_TAIL = /\s*\d{1,2}[:.]\d{2}\s*(am|pm)?\s*$/i;

  function normalizeMessageText(s) {
    var t = String(s || '').replace(/‎|‏| /g, ' ').replace(/\s+/g, ' ').trim();
    t = t.replace(TIME_TAIL, '').trim();
    if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT);
    return t;
  }

  /**
   * Text diff over added nodes. `seen` is a Set used as an insertion-ordered LRU.
   * Returns only texts never seen before (normalized, >= minLen chars), and records them.
   */
  function diffNewTexts(seen, texts, opts) {
    var o = opts || {};
    var max = o.max || 500;
    var minLen = o.minLen == null ? 8 : o.minLen;
    var out = [];
    for (var i = 0; i < texts.length; i++) {
      var t = normalizeMessageText(texts[i]);
      if (t.length < minLen) continue;
      if (seen.has(t)) continue;
      // A container's text that merely concatenates already-seen children is not new.
      if (o.skipSupersets !== false && isConcatOfSeen(t, seen)) { seen.add(t); continue; }
      seen.add(t);
      out.push(t);
    }
    while (seen.size > max) seen.delete(seen.values().next().value);
    return out;
  }

  function isConcatOfSeen(t, seen) {
    if (seen.size === 0 || t.length < 16) return false;
    var rest = t;
    var hit = false;
    seen.forEach(function (s) {
      if (s.length >= 8 && rest.indexOf(s) !== -1) { rest = rest.split(s).join(' '); hit = true; }
    });
    return hit && rest.replace(/\s+/g, '').length < 8;
  }

  // ---------- local (on-device) verdict when the graph is unreachable ----------
  function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  function localVerdict(tri, surface, lang) {
    var trig = (tri && tri.triggers) || [];
    var n = trig.length;
    var S = strings(lang);
    var labels = trig.slice(0, 4).map(function (t) { return lowerFirst(t.label); });
    return {
      id: 'local-' + Date.now().toString(36),
      state: 'local',
      local: true,
      confidence: tri ? tri.score : 0,
      headline: S.localHeadline.replace('{n}', n).replace('{s}', n === 1 ? '' : 's'),
      reason: n ? S.localReason.replace('{n}', n).replace('{s}', n === 1 ? '' : 's').replace('{list}', labels.join(', ')) : S.localReasonNone,
      identifiers: (tri && tri.identifiers || []).map(function (x) { return { type: x.type, value: x.value }; }),
      primary: null,
      stats: { reports: 0, hopsToConfirmed: null, confirmedWithin2Hops: 0, firstSeen: null, lastSeen: null },
      campaign: null,
      ring: null,
      signals: trig,
      actions: [
        { id: 'call_1930', label: S.call1930, href: 'tel:1930' },
        { id: 'chakshu', label: S.chakshu, href: 'https://sancharsaathi.gov.in/sfc/' }
      ],
      latencyMs: 0,
      engine: 'device',
      surface: surface
    };
  }

  // ---------- presentation helpers ----------
  function stateMeta(state, lang) {
    var S = strings(lang);
    switch (state) {
      case 'confirmed': return { word: S.confirmed, icon: 'octagon', tone: 'confirmed' };
      case 'reported': return { word: S.reported, icon: 'triangle', tone: 'caution' };
      case 'local': return { word: S.onDevice, icon: 'diamond', tone: 'local' };
      case 'question': return { word: S.question, icon: 'circle', tone: 'brand' };
      default: return { word: S.clear, icon: 'check', tone: 'clear' };
    }
  }

  var SURFACES = {
    whatsapp_web: 'WhatsApp Web', telegram_web: 'Telegram Web', gmail: 'Gmail', paste: 'Paste',
    download: 'Download', page: 'Website', manual: 'Manual check', notification: 'Notification', demo: 'Demo chat'
  };
  function surfaceLabel(s) { return SURFACES[s] || s || 'JAAL'; }

  /** Whether a verdict should produce any visible card. clear = silence. */
  function shouldShow(v) { return !!v && (v.state === 'reported' || v.state === 'confirmed' || v.state === 'local' || v.state === 'question'); }

  function badgeFor(state, reports) {
    if (state === 'confirmed') return { text: '!', color: '#E5484D' };
    if (state === 'reported') return { text: reports > 99 ? '99+' : String(reports || '?'), color: '#F2A93B' };
    if (state === 'local') return { text: '•', color: '#6E5BFF' };
    return { text: '', color: '#6E5BFF' };
  }

  function pushHistory(list, entry) {
    var l = (list || []).slice();
    l.unshift(entry);
    return l.slice(0, HISTORY_MAX);
  }

  function clampText(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function normalizeApiBase(s) {
    var t = String(s || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(t)) return null;
    return t;
  }

  // ---------- strings (en / hi / gu) ----------
  var STR = {
    en: {
      confirmed: 'Confirmed ring', reported: 'Reported', onDevice: 'On-device', question: 'One question', clear: 'No reports',
      localHeadline: 'Matches {n} scam pattern{s}',
      localReason: 'This message matches {n} scam pattern{s}: {list}.',
      localReasonNone: 'This message looks like known scam scripts.',
      localNote: 'Checked on this device only. JAAL could not reach the network.',
      call1930: 'Call 1930', chakshu: 'Report on Chakshu', details: 'Details', dismiss: 'Dismiss', close: 'Close',
      dispute: 'Think this is wrong? Dispute', share: 'Share with family',
      dlTitle: 'Remote-access app downloading',
      dlQuestion: 'Is someone on a call asking you to install this?',
      yes: 'Yes', no: 'No',
      dlGuideHead: 'Callers who ask for this app take control of the phone or PC',
      dlGuide: ['Hang up. Banks and police never ask you to install apps.', 'Do not read out any code the app shows.', 'Call 1930 (cyber crime helpline) if money moved.'],
      cancelDl: 'Cancel download', removeDl: 'Delete the file', okNo: 'Okay. JAAL will stay quiet about it.',
      reportsNear: 'reports nearby', ringMembers: 'linked identifiers'
    },
    hi: {
      confirmed: 'पुष्ट गिरोह', reported: 'रिपोर्ट किया गया', onDevice: 'सिर्फ़ डिवाइस पर', question: 'एक सवाल', clear: 'कोई रिपोर्ट नहीं',
      localHeadline: '{n} स्कैम पैटर्न से मेल',
      localReason: 'यह संदेश {n} स्कैम पैटर्न से मेल खाता है: {list}।',
      localReasonNone: 'यह संदेश जाने-पहचाने स्कैम जैसा है।',
      localNote: 'सिर्फ़ इसी डिवाइस पर जाँचा गया। नेटवर्क उपलब्ध नहीं था।',
      call1930: '1930 पर कॉल करें', chakshu: 'चक्षु पर रिपोर्ट', details: 'विवरण', dismiss: 'बंद करें', close: 'बंद करें',
      dispute: 'गलत लगे? आपत्ति दर्ज करें', share: 'परिवार को भेजें',
      dlTitle: 'रिमोट-एक्सेस ऐप डाउनलोड हो रहा है',
      dlQuestion: 'क्या कोई कॉल पर आपसे इसे इंस्टॉल करवा रहा है?',
      yes: 'हाँ', no: 'नहीं',
      dlGuideHead: 'यह ऐप माँगने वाले फ़ोन या पीसी पर कब्ज़ा कर लेते हैं',
      dlGuide: ['कॉल काट दें। बैंक और पुलिस कभी ऐप इंस्टॉल नहीं करवाते।', 'ऐप में दिखा कोई कोड न बताएँ।', 'पैसा गया हो तो 1930 पर कॉल करें।'],
      cancelDl: 'डाउनलोड रद्द करें', removeDl: 'फ़ाइल हटाएँ', okNo: 'ठीक है। JAAL इस पर चुप रहेगा।',
      reportsNear: 'आसपास की रिपोर्ट', ringMembers: 'जुड़े पहचानकर्ता'
    },
    gu: {
      confirmed: 'પુષ્ટ ગેંગ', reported: 'રિપોર્ટ થયેલ', onDevice: 'ફક્ત ડિવાઇસ પર', question: 'એક પ્રશ્ન', clear: 'કોઈ રિપોર્ટ નથી',
      localHeadline: '{n} સ્કેમ પેટર્ન સાથે મેળ',
      localReason: 'આ સંદેશ {n} સ્કેમ પેટર્ન સાથે મેળ ખાય છે: {list}.',
      localReasonNone: 'આ સંદેશ જાણીતા સ્કેમ જેવો છે.',
      localNote: 'ફક્ત આ ડિવાઇસ પર તપાસ્યું. નેટવર્ક ઉપલબ્ધ નહોતું.',
      call1930: '1930 પર કૉલ કરો', chakshu: 'ચક્ષુ પર રિપોર્ટ', details: 'વિગતો', dismiss: 'બંધ કરો', close: 'બંધ કરો',
      dispute: 'ખોટું લાગે? વાંધો નોંધાવો', share: 'પરિવારને મોકલો',
      dlTitle: 'રિમોટ-એક્સેસ એપ ડાઉનલોડ થઈ રહી છે',
      dlQuestion: 'શું કોઈ કૉલ પર તમને આ ઇન્સ્ટોલ કરવાનું કહે છે?',
      yes: 'હા', no: 'ના',
      dlGuideHead: 'આ એપ માંગનારા ફોન કે પીસીનો કબજો લઈ લે છે',
      dlGuide: ['કૉલ કાપી નાખો. બેંક અને પોલીસ ક્યારેય એપ ઇન્સ્ટોલ નથી કરાવતા.', 'એપમાં દેખાતો કોઈ કોડ ન કહો.', 'પૈસા ગયા હોય તો 1930 પર કૉલ કરો.'],
      cancelDl: 'ડાઉનલોડ રદ કરો', removeDl: 'ફાઇલ કાઢી નાખો', okNo: 'બરાબર. JAAL આ વિશે શાંત રહેશે.',
      reportsNear: 'આસપાસના રિપોર્ટ', ringMembers: 'જોડાયેલા ઓળખકર્તા'
    }
  };
  function strings(lang) { return STR[lang] || STR.en; }

  return {
    API_BASE_DEFAULT: API_BASE_DEFAULT,
    API_BASE_PROD: API_BASE_PROD,
    PREFIX_TTL_MS: PREFIX_TTL_MS,
    HISTORY_MAX: HISTORY_MAX,
    MAX_TEXT: MAX_TEXT,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    REMOTE: REMOTE,
    sha256Hex: sha256Hex,
    hashIdentifiers: hashIdentifiers,
    prefixHits: prefixHits,
    makeDevice: makeDevice,
    randomHex: randomHex,
    gate: gate,
    afterLookup: afterLookup,
    pasteDecision: pasteDecision,
    payables: payables,
    matchRemoteApp: matchRemoteApp,
    isOutgoing: isOutgoing,
    normalizeMessageText: normalizeMessageText,
    diffNewTexts: diffNewTexts,
    localVerdict: localVerdict,
    stateMeta: stateMeta,
    surfaceLabel: surfaceLabel,
    shouldShow: shouldShow,
    badgeFor: badgeFor,
    pushHistory: pushHistory,
    clampText: clampText,
    normalizeApiBase: normalizeApiBase,
    strings: strings
  };
});
