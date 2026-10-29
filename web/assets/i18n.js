// en / hi / gu strings for the hero, nav and the check page. Elements opt in with data-i18n="key"
// (textContent) or data-i18n-ph="key" (placeholder). Stored in localStorage.
import { store } from './lib.js';

export const STR = {
  en: {
    'nav.how': 'How it works', 'nav.graph': 'Why a graph', 'nav.privacy': 'Privacy', 'nav.pricing': 'Pricing', 'nav.check': 'Check something',
    'hero.eyebrow': 'Ambient scam shield for India',
    'hero.title': 'JAAL watches for scam rings, so you don’t have to.',
    'hero.sub': 'It sits quietly in Chrome and on Android. When a number, UPI ID or link belongs to a ring others have reported, you see it before you pay. Nothing you read is uploaded.',
    'hero.cta': 'Add to Chrome', 'hero.cta2': 'Check something now', 'hero.unpacked': 'Install steps',
    'hero.note': 'Free. No account. No contacts. Works in English, हिन्दी, ગુજરાતી.',
    'c.users': 'People protected', 'c.checks': 'Checks answered', 'c.ids': 'Identifiers in the graph', 'c.rings': 'Rings detected', 'c.paying': 'Families on Shield',
    'check.title': 'Check before you pay',
    'check.sub': 'Paste the message, or just the number, UPI ID, link or wallet. Only the identifiers are checked.',
    'check.ph': 'Paste a message, number, UPI ID, link or wallet',
    'check.go': 'Check', 'check.voice': 'Speak', 'check.listening': 'Listening…', 'check.try': 'Try one',
    'check.ex1': 'KYC refund SMS', 'check.ex2': 'Unknown +92 number', 'check.ex3': 'A friend’s UPI',
    'check.found': 'Found on this device, not uploaded:', 'check.none': 'No numbers, UPI IDs or links found yet.',
    'check.privacy': 'Only hashed identifiers leave this page. Your message text stays here.'
  },
  hi: {
    'nav.how': 'यह कैसे काम करता है', 'nav.graph': 'ग्राफ़ क्यों', 'nav.privacy': 'प्राइवेसी', 'nav.pricing': 'कीमत', 'nav.check': 'कुछ जाँचें',
    'hero.eyebrow': 'भारत के लिए हमेशा चालू स्कैम कवच',
    'hero.title': 'स्कैम गिरोहों पर JAAL नज़र रखता है, ताकि आपको न रखनी पड़े।',
    'hero.sub': 'यह Chrome और Android में चुपचाप चलता है। जब कोई नंबर, UPI ID या लिंक किसी ऐसे गिरोह का हो जिसकी दूसरों ने शिकायत की है, तो आपको पेमेंट से पहले दिख जाता है। आप जो पढ़ते हैं, वह अपलोड नहीं होता।',
    'hero.cta': 'Chrome में जोड़ें', 'hero.cta2': 'अभी कुछ जाँचें', 'hero.unpacked': 'इंस्टॉल के चरण',
    'hero.note': 'मुफ़्त। कोई अकाउंट नहीं। कॉन्टैक्ट्स नहीं।',
    'c.users': 'सुरक्षित लोग', 'c.checks': 'जाँचें पूरी', 'c.ids': 'ग्राफ़ में पहचान', 'c.rings': 'पकड़े गए गिरोह', 'c.paying': 'Shield पर परिवार',
    'check.title': 'पेमेंट से पहले जाँचें',
    'check.sub': 'पूरा मैसेज चिपकाएँ, या सिर्फ़ नंबर, UPI ID, लिंक या वॉलेट। सिर्फ़ पहचान की जाँच होती है।',
    'check.ph': 'मैसेज, नंबर, UPI ID, लिंक या वॉलेट चिपकाएँ',
    'check.go': 'जाँचें', 'check.voice': 'बोलें', 'check.listening': 'सुन रहे हैं…', 'check.try': 'आज़माएँ',
    'check.ex1': 'KYC रिफ़ंड SMS', 'check.ex2': 'अनजान +92 नंबर', 'check.ex3': 'दोस्त की UPI',
    'check.found': 'इस डिवाइस पर मिला, अपलोड नहीं हुआ:', 'check.none': 'अभी कोई नंबर, UPI ID या लिंक नहीं मिला।',
    'check.privacy': 'सिर्फ़ हैश की हुई पहचान इस पेज से बाहर जाती है। आपका मैसेज यहीं रहता है।'
  },
  gu: {
    'nav.how': 'આ કેવી રીતે કામ કરે છે', 'nav.graph': 'ગ્રાફ કેમ', 'nav.privacy': 'પ્રાઇવસી', 'nav.pricing': 'કિંમત', 'nav.check': 'કંઈક તપાસો',
    'hero.eyebrow': 'ભારત માટે સતત ચાલતું સ્કેમ કવચ',
    'hero.title': 'સ્કેમ ટોળકીઓ પર JAAL નજર રાખે છે, જેથી તમારે ન રાખવી પડે.',
    'hero.sub': 'તે Chrome અને Android માં શાંતિથી ચાલે છે. કોઈ નંબર, UPI ID કે લિંક એવી ટોળકીની હોય જેની બીજાએ ફરિયાદ કરી છે, તો ચુકવણી પહેલાં તમને દેખાય છે. તમે જે વાંચો છો તે અપલોડ થતું નથી.',
    'hero.cta': 'Chrome માં ઉમેરો', 'hero.cta2': 'હમણાં કંઈક તપાસો', 'hero.unpacked': 'ઇન્સ્ટોલનાં પગલાં',
    'hero.note': 'મફત. કોઈ એકાઉન્ટ નહીં. કોન્ટેક્ટ્સ નહીં.',
    'c.users': 'સુરક્ષિત લોકો', 'c.checks': 'જવાબ આપેલી તપાસ', 'c.ids': 'ગ્રાફમાં ઓળખ', 'c.rings': 'પકડાયેલી ટોળકી', 'c.paying': 'Shield પર પરિવારો',
    'check.title': 'ચુકવણી પહેલાં તપાસો',
    'check.sub': 'આખો મેસેજ પેસ્ટ કરો, અથવા ફક્ત નંબર, UPI ID, લિંક કે વોલેટ. ફક્ત ઓળખની તપાસ થાય છે.',
    'check.ph': 'મેસેજ, નંબર, UPI ID, લિંક કે વોલેટ પેસ્ટ કરો',
    'check.go': 'તપાસો', 'check.voice': 'બોલો', 'check.listening': 'સાંભળી રહ્યા છીએ…', 'check.try': 'અજમાવો',
    'check.ex1': 'KYC રિફંડ SMS', 'check.ex2': 'અજાણ્યો +92 નંબર', 'check.ex3': 'મિત્રની UPI',
    'check.found': 'આ ડિવાઇસ પર મળ્યું, અપલોડ નથી થયું:', 'check.none': 'હજી કોઈ નંબર, UPI ID કે લિંક મળ્યાં નથી.',
    'check.privacy': 'ફક્ત હેશ કરેલી ઓળખ આ પેજની બહાર જાય છે. તમારો મેસેજ અહીં જ રહે છે.'
  }
};

export const LANGS = [['en', 'EN', 'English'], ['hi', 'हि', 'हिन्दी'], ['gu', 'ગુ', 'ગુજરાતી']];

export function getLang() { const l = store.get('lang', 'en'); return STR[l] ? l : 'en'; }
export function t(key, lang = getLang()) { return (STR[lang] && STR[lang][key]) || STR.en[key] || key; }

const listeners = [];
export function onLang(fn) { listeners.push(fn); }

export function applyLang(lang = getLang()) {
  document.documentElement.lang = lang === 'en' ? 'en-IN' : lang;
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n, lang); });
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => { e.setAttribute('placeholder', t(e.dataset.i18nPh, lang)); });
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  listeners.forEach((fn) => fn(lang));
}

/** Renders the EN / हि / ગુ segmented control into every .lang container. */
export function mountLang() {
  document.querySelectorAll('.lang').forEach((wrap) => {
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Language');
    wrap.innerHTML = '';
    LANGS.forEach(([code, short, name]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.lang = code; b.textContent = short; b.title = name; b.setAttribute('aria-label', name);
      b.addEventListener('click', () => { store.set('lang', code); applyLang(code); });
      wrap.append(b);
    });
  });
  applyLang();
}
