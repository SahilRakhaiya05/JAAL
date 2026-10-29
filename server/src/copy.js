// Verdict copy in English, Hindi and Gujarati.
// Rules (SPEC): led by counts, "reported" and "ring", never "fraud"; state and offer, never
// command; headline under 12 words; reason is one sentence with numbers.
// Hindi and Gujarati strings are deliberately simple; flagged for native-speaker review
// before launch (NATIVE-REVIEW).

const NOUN = {
  en: { phone: 'number', upi: 'UPI handle', bank_account: 'account', ifsc: 'bank code', url: 'link', domain: 'website', apk: 'app file', crypto: 'wallet', remote_app: 'app' },
  // NATIVE-REVIEW (hi)
  hi: { phone: 'नंबर', upi: 'UPI हैंडल', bank_account: 'खाते', ifsc: 'बैंक कोड', url: 'लिंक', domain: 'वेबसाइट', apk: 'ऐप फ़ाइल', crypto: 'वॉलेट', remote_app: 'ऐप' },
  // NATIVE-REVIEW (gu)
  gu: { phone: 'નંબર', upi: 'UPI હેન્ડલ', bank_account: 'ખાતા', ifsc: 'બેંક કોડ', url: 'લિંક', domain: 'વેબસાઇટ', apk: 'એપ ફાઇલ', crypto: 'વૉલેટ', remote_app: 'એપ' }
};

const HEADLINE = {
  en: {
    people: (n, noun) => `${n} ${n === 1 ? 'person' : 'people'} reported this ${noun}`,
    feed: (feed) => `Listed on the ${feed} public phishing feed`,
    neighbour: (m, noun) => `${m} reports linked to this ${noun}`,
    review: (h) => `${h}; under review`,
    clear: (noun) => `No reports for this ${noun}`,
    signals: (k) => `${k} warning ${k === 1 ? 'sign' : 'signs'}, no reports yet`,
    lookalike: (brand) => `No reports; website looks like ${brand}`,
    empty: () => 'Nothing to check in this message'
  },
  hi: {
    people: (n, noun) => (n === 1 ? `1 व्यक्ति ने इस ${noun} को रिपोर्ट किया है` : `${n} लोगों ने इस ${noun} को रिपोर्ट किया है`),
    feed: () => 'सार्वजनिक फ़िशिंग सूची में दर्ज',
    neighbour: (m, noun) => `${m} रिपोर्ट इस ${noun} से जुड़ी हैं`,
    review: (h) => `${h}; जाँच जारी है`,
    clear: (noun) => `इस ${noun} की कोई रिपोर्ट नहीं`,
    signals: (k) => `${k} चेतावनी संकेत, अभी कोई रिपोर्ट नहीं`,
    lookalike: (brand) => `कोई रिपोर्ट नहीं; वेबसाइट ${brand} जैसी दिखती है`,
    empty: () => 'इस संदेश में जाँचने लायक कुछ नहीं'
  },
  gu: {
    people: (n, noun) => (n === 1 ? `1 વ્યક્તિએ આ ${noun}ની જાણ કરી છે` : `${n} લોકોએ આ ${noun}ની જાણ કરી છે`),
    feed: () => 'જાહેર ફિશિંગ યાદીમાં નોંધાયેલ',
    neighbour: (m, noun) => `${m} રિપોર્ટ આ ${noun} સાથે જોડાયેલા છે`,
    review: (h) => `${h}; તપાસ ચાલુ છે`,
    clear: (noun) => `આ ${noun}ની કોઈ રિપોર્ટ નથી`,
    signals: (k) => `${k} ચેતવણી સંકેત, હજી કોઈ રિપોર્ટ નથી`,
    lookalike: (brand) => `કોઈ રિપોર્ટ નથી; વેબસાઇટ ${brand} જેવી દેખાય છે`,
    empty: () => 'આ સંદેશમાં તપાસવા જેવું કંઈ નથી'
  }
};

const FEED_LABEL = { openphish: 'OpenPhish', urlhaus: 'URLhaus', metamask: 'MetaMask', scamsniffer_domains: 'ScamSniffer', scamsniffer_addresses: 'ScamSniffer' };
export const feedLabel = (name) => FEED_LABEL[name] || name;

const langOf = (lang) => (HEADLINE[lang] ? lang : 'en');
export const nounOf = (type, lang = 'en') => NOUN[langOf(lang)][type] || NOUN.en[type] || 'identifier';

/**
 * ctx: { state, via, primaryType, people, neighbourReports, feeds[], disputed, signals, lookalike, hasIdentifiers }
 */
export function headline(ctx, lang = 'en') {
  const L = langOf(lang);
  const H = HEADLINE[L];
  const noun = nounOf(ctx.primaryType, L);
  let h;
  if (!ctx.hasIdentifiers) h = ctx.signals ? H.signals(ctx.signals) : H.empty();
  else if (ctx.people > 0 && ctx.state !== 'clear') h = H.people(ctx.people, noun);
  else if (ctx.feeds?.length && ctx.state === 'confirmed') h = H.feed(feedLabel(ctx.feeds[0]));
  else if (ctx.state === 'reported' && ctx.neighbourReports) h = H.neighbour(ctx.neighbourReports, noun);
  else if (ctx.lookalike) h = H.lookalike(ctx.lookalike.target);
  else if (ctx.signals) h = H.signals(ctx.signals);
  else h = H.clear(noun);
  return ctx.disputed ? H.review(h) : h;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ago = (days) => (days === 0 ? 'today' : `${plural(days, 'day', 'days')} ago`);

/**
 * One plain sentence with numbers, e.g.
 * "This number is 2 hops from 47 confirmed reports and shares a payout account with campaign 482, first seen 9 days ago."
 * ctx adds: stats { reports, hopsToConfirmed, confirmedWithin2Hops }, clusters, campaign, campaignRole, firstSeenDays, signalLabels
 */
export function reason(ctx, lang = 'en') {
  const L = langOf(lang);
  if (L === 'hi') return reasonHi(ctx);
  if (L === 'gu') return reasonGu(ctx);
  const noun = nounOf(ctx.primaryType, 'en');
  if (!ctx.hasIdentifiers) {
    return ctx.signals
      ? `No number, handle or link found; the message shows ${plural(ctx.signals, 'warning sign', 'warning signs')}: ${ctx.signalLabels.join(', ').toLowerCase()}.`
      : 'No number, handle, account or link was found in this message.';
  }
  const s = ctx.stats;
  let a;
  if (ctx.state === 'clear') {
    if (ctx.lookalike) return `No reports yet, but this website looks like ${ctx.lookalike.target} (${Math.round(ctx.lookalike.score * 100)}% match).`;
    return `No report touches this ${noun} or anything within 2 hops in the last 90 days.`;
  }
  if (s.hopsToConfirmed > 0 && s.confirmedWithin2Hops > 0 && ctx.people <= 1) a = `is ${plural(s.hopsToConfirmed, 'hop', 'hops')} from ${s.confirmedWithin2Hops} confirmed reports`;
  else if (ctx.people > 0) a = `was reported by ${plural(ctx.people, 'person', 'people')} in ${plural(ctx.clusters, 'independent group', 'independent groups')}`;
  else if (ctx.feeds?.length) {
    const names = [...new Set(ctx.feeds.map(feedLabel))];
    a = `is listed on the ${names.join(' and ')} public ${names.length === 1 ? 'feed' : 'feeds'}`;
  } else a = `is directly linked to ${plural(ctx.neighbourReports, 'report', 'reports')}`;
  let b = '';
  const c = ctx.campaign;
  if (c && ctx.campaignRole === 'payout') b = ` and is the payout point for ${plural(ctx.inboundPhones, 'number', 'numbers')} in campaign ${c.id}`;
  else if (c && ctx.campaignRole === 'shares_payout') b = ` and shares a payout account with campaign ${c.id}`;
  else if (c) b = ` and sits in campaign ${c.id} with ${plural(c.size, 'reporting person', 'reporting people')}`;
  const when = ctx.firstSeenDays != null ? `, first seen ${ago(ctx.firstSeenDays)}` : '';
  return `This ${noun} ${a}${b}${when}.`;
}

// NATIVE-REVIEW (hi)
function reasonHi(ctx) {
  const noun = nounOf(ctx.primaryType, 'hi');
  if (!ctx.hasIdentifiers) return ctx.signals ? `कोई नंबर या लिंक नहीं मिला; संदेश में ${ctx.signals} चेतावनी संकेत हैं।` : 'इस संदेश में कोई नंबर, हैंडल या लिंक नहीं मिला।';
  if (ctx.state === 'clear') {
    if (ctx.lookalike) return `अभी कोई रिपोर्ट नहीं, पर यह वेबसाइट ${ctx.lookalike.target} जैसी दिखती है (${Math.round(ctx.lookalike.score * 100)}% मेल)।`;
    return `पिछले 90 दिनों में इस ${noun} या इसके 2 कदम के दायरे में कोई रिपोर्ट नहीं है।`;
  }
  const s = ctx.stats;
  const parts = [];
  if (ctx.people === 1) parts.push('1 व्यक्ति ने रिपोर्ट किया');
  else if (ctx.people > 1) parts.push(`${ctx.people} लोगों ने ${ctx.clusters} अलग-अलग समूहों से रिपोर्ट किया`);
  if (s.hopsToConfirmed > 0 && s.confirmedWithin2Hops > 0) parts.push(`यह ${s.confirmedWithin2Hops} पुष्ट रिपोर्ट से ${s.hopsToConfirmed} कदम दूर है`);
  if (ctx.campaign) parts.push(`अभियान ${ctx.campaign.id} का हिस्सा`);
  if (ctx.firstSeenDays != null) parts.push(`पहली बार ${ctx.firstSeenDays} दिन पहले देखा गया`);
  if (!parts.length) parts.push(`${ctx.neighbourReports || 0} रिपोर्ट से सीधा जुड़ा है`);
  return `${parts.join('; ')}।`;
}

// NATIVE-REVIEW (gu)
function reasonGu(ctx) {
  const noun = nounOf(ctx.primaryType, 'gu');
  if (!ctx.hasIdentifiers) return ctx.signals ? `કોઈ નંબર કે લિંક મળી નથી; સંદેશમાં ${ctx.signals} ચેતવણી સંકેત છે.` : 'આ સંદેશમાં કોઈ નંબર, હેન્ડલ કે લિંક મળી નથી.';
  if (ctx.state === 'clear') {
    if (ctx.lookalike) return `હજી કોઈ રિપોર્ટ નથી, પણ આ વેબસાઇટ ${ctx.lookalike.target} જેવી દેખાય છે (${Math.round(ctx.lookalike.score * 100)}% મેળ).`;
    return `છેલ્લા 90 દિવસમાં આ ${noun} કે તેના 2 પગલાંના દાયરામાં કોઈ રિપોર્ટ નથી.`;
  }
  const s = ctx.stats;
  const parts = [];
  if (ctx.people === 1) parts.push('1 વ્યક્તિએ જાણ કરી');
  else if (ctx.people > 1) parts.push(`${ctx.people} લોકોએ ${ctx.clusters} અલગ જૂથોમાંથી જાણ કરી`);
  if (s.hopsToConfirmed > 0 && s.confirmedWithin2Hops > 0) parts.push(`આ ${s.confirmedWithin2Hops} પુષ્ટ રિપોર્ટથી ${s.hopsToConfirmed} પગલાં દૂર છે`);
  if (ctx.campaign) parts.push(`અભિયાન ${ctx.campaign.id}નો ભાગ`);
  if (ctx.firstSeenDays != null) parts.push(`પહેલી વાર ${ctx.firstSeenDays} દિવસ પહેલાં દેખાયું`);
  if (!parts.length) parts.push(`${ctx.neighbourReports || 0} રિપોર્ટ સાથે સીધું જોડાયેલું છે`);
  return `${parts.join('; ')}.`;
}

export const ACTION_LABELS = {
  en: { chakshu: 'Report on Chakshu', call_1930: 'Call 1930 helpline', share_family: 'Warn family on WhatsApp', bank_email: 'Email your bank', dispute: 'This is mine, dispute', report: 'Report this' },
  // NATIVE-REVIEW (hi)
  hi: { chakshu: 'चक्षु पर रिपोर्ट करें', call_1930: '1930 हेल्पलाइन पर कॉल', share_family: 'परिवार को WhatsApp पर बताएं', bank_email: 'बैंक को ईमेल', dispute: 'यह मेरा है, आपत्ति', report: 'रिपोर्ट करें' },
  // NATIVE-REVIEW (gu)
  gu: { chakshu: 'ચક્ષુ પર જાણ કરો', call_1930: '1930 હેલ્પલાઇન પર કૉલ', share_family: 'પરિવારને WhatsApp પર જણાવો', bank_email: 'બેંકને ઇમેઇલ', dispute: 'આ મારું છે, વાંધો', report: 'જાણ કરો' }
};
export const actionLabel = (id, lang) => (ACTION_LABELS[lang] || ACTION_LABELS.en)[id];
