/*
 * JAAL shared extraction + on-device triage.
 *
 * One file, three runtimes: Node (CommonJS, via require/import), the browser
 * (classic <script>, sets globalThis.JaalExtract) and Chrome extension content
 * scripts. No dependencies. Keep it that way: it runs on every notification.
 *
 * Contract (see SPEC.md):
 *   extract(text)  -> Identifier[]   { type, value, raw, key }
 *   triage(text)   -> { score, level, triggers[], identifiers[] }
 *   canonicalKey(type, value) -> "type:value"  (the string that gets hashed)
 *   hashPrefix(hexDigest) -> first 8 hex chars
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JaalExtract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Identifier types the graph understands. Order matters for de-duplication:
  // a UPI handle must win over the "email-ish" text it looks like.
  var TYPES = ['phone', 'upi', 'bank_account', 'ifsc', 'url', 'domain', 'apk', 'crypto', 'remote_app'];

  var UPI_PSPS = [
    'ybl', 'ibl', 'axl', 'okaxis', 'okhdfcbank', 'okicici', 'oksbi', 'paytm', 'ptyes', 'ptaxis', 'pthdfc', 'ptsbi',
    'upi', 'apl', 'yapl', 'rapl', 'axisbank', 'icici', 'hdfcbank', 'sbi', 'kotak', 'indus', 'federal', 'idfcbank',
    'jupiteraxis', 'fam', 'freecharge', 'airtel', 'jio', 'waaxis', 'wahdfcbank', 'wasbi', 'waicici', 'pingpay',
    'yesbank', 'barodampay', 'pnb', 'cnrb', 'boi', 'unionbank', 'ikwik', 'timecosmos', 'abfspay', 'superyes', 'naviaxis'
  ];

  var SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 't.ly', 'rb.gy', 'is.gd', 'shorturl.at', 'tiny.cc', 'ow.ly', 'rebrand.ly', 'shrtco.de', 'goo.gl', 'surl.li', 'wa.link', 'wa.me'];

  var REMOTE_APPS = ['anydesk', 'teamviewer', 'quicksupport', 'airdroid', 'rustdesk', 'ultraviewer', 'supremo', 'alpemix', 'splashtop', 'remotepc'];

  var TLDS = 'com|in|net|org|xyz|top|info|co|io|app|link|live|site|online|shop|club|vip|cc|me|ly|gl|ws|biz|icu|buzz|cyou|sbs|click|world|today|store|tech|pro|work|life|fun|space|website|cloud|support|help|bond|win|loan|money|finance|bank|gov\\.in|co\\.in|org\\.in|net\\.in';

  // ---------- regexes (all global, all built once) ----------
  var RE = {
    url: /\bhttps?:\/\/[^\s<>"'`)\]]+/gi,
    bareDomain: new RegExp('\\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:' + TLDS + '))(?![a-z0-9-])(\\/[^\\s<>"\'`)\\]]*)?', 'gi'),
    // Indian mobile with optional +91 / 0 prefix and one optional separator in the middle.
    phoneIn: /(?:^|[^\d+])((?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5})(?!\d)/g,
    // International E.164 with an explicit plus (non-Indian scam numbers: +92, +855, +1 ...).
    phoneIntl: /(?:^|[^\d])(\+(?!91)[1-9]\d{7,14})(?!\d)/g,
    // name@psp, where psp has no dot after it (that would be an email).
    upi: /(?:^|[^\w.@-])([a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,30})(?![\w.@-]*\.[a-z])/gi,
    ifsc: /\b([A-Z]{4}0[A-Z0-9]{6})\b/g,
    bankAccount: /(?:a\/c|acc(?:ount)?|khata|खाता)\.?\s*(?:no|number|num|sankhya)?\.?\s*[:.#-]?\s*((?:\d[\s-]?){9,18})(?!\d)/gi,
    apk: /(?:^|[\s/"'(])([\w.()\-]{1,120}\.apk)\b/gi,
    btcBech32: /\b(bc1[ac-hj-np-z02-9]{11,71})\b/g,
    btcLegacy: /\b([13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
    eth: /\b(0x[a-fA-F0-9]{40})\b/g,
    trx: /\b(T[1-9A-HJ-NP-Za-km-z]{33})\b/g,
    xmr: /\b([48][0-9AB][1-9A-HJ-NP-Za-km-z]{93})\b/g,
    remoteCode: /\b(\d{3}[\s-]?\d{3}[\s-]?\d{3}(?:[\s-]?\d{1,3})?)\b/g
  };

  // ---------- normalisers ----------
  function normPhone(raw) {
    var d = raw.replace(/[^\d+]/g, '');
    if (d.charAt(0) === '+') {
      if (d.indexOf('+91') === 0 && d.length === 13) return '+91' + d.slice(3);
      return d;
    }
    d = d.replace(/^0+/, '');
    if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
    if (d.length === 10) return '+91' + d;
    return null;
  }

  function normUrl(raw) {
    var s = raw.trim().replace(/[.,;:!?]+$/, '');
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    try {
      var u = new URL(s);
      var host = u.hostname.toLowerCase().replace(/^www\./, '');
      var path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
      return { url: u.protocol + '//' + host + path + (u.search || ''), host: host };
    } catch (e) {
      return null;
    }
  }

  // Registrable-ish domain: last two labels, or last three for *.co.in / *.gov.in style.
  function registrable(host) {
    var parts = host.split('.');
    if (parts.length <= 2) return host;
    var last2 = parts.slice(-2).join('.');
    if (/^(co|gov|org|net|ac|edu|nic|res|firm|gen|ind)\.in$/.test(last2)) return parts.slice(-3).join('.');
    return last2;
  }

  function canonicalKey(type, value) {
    return type + ':' + value;
  }

  function hashPrefix(hexDigest) {
    return String(hexDigest).slice(0, 8);
  }

  function push(out, seen, type, value, raw, extra) {
    if (!value) return;
    var key = canonicalKey(type, value);
    if (seen[key]) return;
    seen[key] = true;
    var item = { type: type, value: value, raw: raw, key: key };
    if (extra) for (var k in extra) item[k] = extra[k];
    out.push(item);
  }

  function each(re, text, fn) {
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      fn(m);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  /**
   * Pull every scammer-side identifier out of a blob of text.
   * Never returns emails or personal names: those are not identifiers we store.
   */
  function extract(text) {
    if (!text || typeof text !== 'string') return [];
    var t = text.normalize ? text.normalize('NFKC') : text;
    var out = [];
    var seen = {};
    var urlSpans = [];

    each(RE.url, t, function (m) {
      var n = normUrl(m[0]);
      if (!n) return;
      urlSpans.push([m.index, m.index + m[0].length]);
      var shortener = SHORTENERS.indexOf(n.host) !== -1;
      push(out, seen, 'url', n.url, m[0], { shortener: shortener });
      // Raw IP hosts have no registrable domain; keep the URL only.
      if (!/^\d+(\.\d+)+$/.test(n.host)) push(out, seen, 'domain', registrable(n.host), n.host);
    });

    each(RE.bareDomain, t, function (m) {
      var idx = m.index;
      for (var i = 0; i < urlSpans.length; i++) if (idx >= urlSpans[i][0] && idx < urlSpans[i][1]) return;
      var before = t.charAt(idx - 1);
      if (before === '@') return; // part of an email or UPI handle
      var n = normUrl(m[0]);
      if (!n) return;
      if (/^\d+(\.\d+)+$/.test(n.host)) return; // version numbers, amounts
      push(out, seen, 'domain', registrable(n.host), n.host);
      if (m[2]) push(out, seen, 'url', n.url, m[0], { shortener: SHORTENERS.indexOf(n.host) !== -1 });
    });

    each(RE.upi, t, function (m) {
      var v = m[1].toLowerCase();
      var psp = v.split('@')[1];
      push(out, seen, 'upi', v, m[1], { knownPsp: UPI_PSPS.indexOf(psp) !== -1 });
    });

    each(RE.phoneIn, t, function (m) {
      push(out, seen, 'phone', normPhone(m[1]), m[1]);
    });
    each(RE.phoneIntl, t, function (m) {
      push(out, seen, 'phone', normPhone(m[1]), m[1]);
    });

    each(RE.ifsc, t, function (m) {
      push(out, seen, 'ifsc', m[1].toUpperCase(), m[1]);
    });
    each(RE.bankAccount, t, function (m) {
      var digits = m[1].replace(/\D/g, '');
      if (digits.length >= 9 && digits.length <= 18) push(out, seen, 'bank_account', digits, m[1]);
    });

    each(RE.apk, t, function (m) {
      push(out, seen, 'apk', m[1].toLowerCase(), m[1]);
    });

    each(RE.btcBech32, t, function (m) { push(out, seen, 'crypto', m[1].toLowerCase(), m[1], { chain: 'btc' }); });
    each(RE.eth, t, function (m) { push(out, seen, 'crypto', m[1].toLowerCase(), m[1], { chain: 'eth' }); });
    each(RE.xmr, t, function (m) { push(out, seen, 'crypto', m[1], m[1], { chain: 'xmr' }); });
    each(RE.trx, t, function (m) { push(out, seen, 'crypto', m[1], m[1], { chain: 'trx' }); });
    each(RE.btcLegacy, t, function (m) {
      // Legacy BTC collides with random base58-ish tokens; require a crypto word nearby.
      var ctx = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).toLowerCase();
      if (/btc|bitcoin|wallet|crypto|usdt|deposit/.test(ctx)) push(out, seen, 'crypto', m[1], m[1], { chain: 'btc' });
    });

    var lower = t.toLowerCase();
    for (var i = 0; i < REMOTE_APPS.length; i++) {
      if (lower.indexOf(REMOTE_APPS[i]) !== -1) push(out, seen, 'remote_app', REMOTE_APPS[i], REMOTE_APPS[i]);
    }

    // Phone numbers are a subset of bank-account-looking digit runs; drop accounts
    // whose digits are exactly a phone we already captured.
    var phones = {};
    out.forEach(function (x) { if (x.type === 'phone') phones[x.value.slice(-10)] = true; });
    return out.filter(function (x) { return !(x.type === 'bank_account' && phones[x.value.slice(-10)] && x.value.length === 10); });
  }

  // ---------- on-device triage ----------
  // A tiny weighted model over handcrafted features. Runs in well under 1 ms.
  // Weights were hand-set from the Indian scam taxonomy in SPEC.md; the
  // quantized transformer classifier is the named next step, not this weekend.
  var SIGNALS = [
    { id: 'otp', w: 1.4, re: /\botp\b|one[\s-]?time password|ओटीपी|ઓટીપી|verification code/i, label: 'Asks for an OTP' },
    { id: 'pin', w: 1.6, re: /upi\s*pin|atm\s*pin|enter (your )?pin|पिन डाल|પિન/i, label: 'Asks for a UPI or ATM PIN' },
    { id: 'kyc', w: 1.1, re: /\be-?kyc\b|kyc (update|pending|expired|verification)|केवाईसी|કેવાયસી/i, label: 'KYC update pressure' },
    { id: 'block', w: 1.0, re: /(account|card|sim|number|wallet).{0,30}(block|suspend|deactivat|band|बंद|freeze)|will be (blocked|suspended|closed)/i, label: 'Threatens to block an account' },
    { id: 'arrest', w: 1.9, re: /digital arrest|arrest warrant|\bcbi\b|\bed\b officer|narcotics|customs.{0,20}(parcel|package)|money laundering|गिरफ्तार|सीबीआई|ધરપકડ/i, label: 'Digital arrest script' },
    { id: 'parcel', w: 0.8, re: /(fedex|dhl|courier|parcel|package).{0,40}(seized|held|drugs|illegal|customs)/i, label: 'Seized parcel story' },
    { id: 'refund', w: 0.8, re: /refund|cashback|reversal|wrongly (sent|credited)|galti se/i, label: 'Refund or wrong-transfer story' },
    { id: 'prize', w: 0.9, re: /lottery|you (have )?won|prize|lucky draw|kbc|jackpot|इनाम|लॉटरी/i, label: 'Prize or lottery' },
    { id: 'job', w: 0.9, re: /work from home|part[\s-]?time (job|work)|earn (rs\.?|₹|inr)?\s?\d|daily (income|payout)|like (youtube )?videos|prepaid task|telegram task/i, label: 'Task or part-time job offer' },
    { id: 'invest', w: 1.0, re: /guaranteed (returns|profit)|double your|\d{2,3}% (returns|profit)|stock tips|ipo allotment|vip group|trading (app|group)/i, label: 'Investment returns promise' },
    { id: 'bill', w: 0.9, re: /electricity (bill|connection).{0,40}(disconnect|cut)|bijli|light bill/i, label: 'Electricity disconnection threat' },
    { id: 'urgent', w: 0.6, re: /urgent|immediately|within (24|2|1) ?(hours|hrs|minutes|mins)|today itself|last chance|तुरंत|abhi/i, label: 'Urgency pressure' },
    { id: 'screenshare', w: 1.5, re: /screen ?shar|anydesk|teamviewer|quicksupport|rustdesk|airdroid|remote (access|support)/i, label: 'Asks to share screen or install remote access' },
    { id: 'apk', w: 1.3, re: /\.apk\b|install (this|the) app|download (this|the) app/i, label: 'Pushes an APK install' },
    { id: 'pay', w: 0.7, re: /pay (rs\.?|₹|inr)?\s?\d|send (rs\.?|₹|inr)?\s?\d|processing fee|registration fee|security deposit|transfer (rs\.?|₹)/i, label: 'Requests a payment or fee' },
    { id: 'shortlink', w: 0.6, re: /\b(bit\.ly|tinyurl\.com|cutt\.ly|rb\.gy|is\.gd|t\.ly|shorturl\.at|surl\.li)\b/i, label: 'Shortened link' }
  ];

  var BIAS = -2.2;

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  /**
   * Cheap on-device pass. `level`:
   *   'ignore'  - discard, never leaves the device
   *   'check'   - has identifiers and a weak signal; ask the hash-prefix set
   *   'trigger' - strong signal; run the full graph check
   */
  function triage(text, context) {
    var t = String(text || '');
    var ids = extract(t);
    var z = BIAS;
    var triggers = [];
    for (var i = 0; i < SIGNALS.length; i++) {
      if (SIGNALS[i].re.test(t)) {
        z += SIGNALS[i].w;
        triggers.push({ id: SIGNALS[i].id, label: SIGNALS[i].label });
      }
    }
    var hasPayable = ids.some(function (x) { return x.type === 'upi' || x.type === 'bank_account' || x.type === 'crypto'; });
    var hasLink = ids.some(function (x) { return x.type === 'url' || x.type === 'apk'; });
    if (hasPayable) z += 0.8;
    if (hasLink) z += 0.5;
    if (context && context.unknownSender) z += 0.6;
    if (context && context.onCall) z += 1.2;
    var score = Math.round(sigmoid(z) * 1000) / 1000;
    var level = score >= 0.6 ? 'trigger' : (ids.length && score >= 0.2 ? 'check' : 'ignore');
    return { score: score, level: level, triggers: triggers, identifiers: ids };
  }

  return {
    TYPES: TYPES,
    REMOTE_APPS: REMOTE_APPS,
    SHORTENERS: SHORTENERS,
    UPI_PSPS: UPI_PSPS,
    extract: extract,
    triage: triage,
    canonicalKey: canonicalKey,
    hashPrefix: hashPrefix,
    normPhone: normPhone,
    normUrl: normUrl,
    registrable: registrable
  };
});
