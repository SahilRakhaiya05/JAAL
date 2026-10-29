// Curated Indian demo dataset: eight campaigns modelled on the most reported scam patterns.
// Every value is synthetic. Phones use the reserved-looking block +91 9C000 NNNNN (C = campaign),
// bank accounts are made up, IFSC is the obviously fake JAAL0DEMO01, domains are invented.
// Everything is tagged source "demo" and removed by `npm run seed:clear-demo`.
//
// Pitch numbers this dataset produces on purpose:
//  - upi:refund.desk@ybl is reported by exactly 61 people; 61 numbers pay into one account.
//  - phone +91 92000 99001 is 2 identifier hops from 47 confirmed reports (digital arrest ring).
import { DAY_MS } from '../util.js';

const IFSC = 'JAAL0DEMO01';

/** Deterministic PRNG so every seed run produces the same graph. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const phone = (c, i) => `9${c}000${String(i).padStart(5, '0')}`;
const fmtPhone = (p, rnd) => {
  const r = rnd();
  if (r < 0.35) return `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
  if (r < 0.7) return p;
  return `${p.slice(0, 5)}-${p.slice(5)}`;
};
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

function payLine(payTo, k, lang) {
  const payee = k.accounts.includes(payTo) ? (lang === 'en' ? `A/c no ${payTo} IFSC ${IFSC}` : `खाता no ${payTo}`) : payTo;
  if (lang === 'hi') return `शुल्क ${payee} पर भेजें`;
  if (lang === 'gu') return `ફી ${payee} પર ભરો`;
  return `Pay the fee to ${payee} today.`;
}

/**
 * Campaign recipe:
 *  phones      how many distinct caller numbers
 *  startDay    first report, days before now (spread to endDay)
 *  cities      in the order the ring moved through them
 *  messages    (ctx) => text; ctx has phone, upi, acct, url, apk, wallet
 *  payout(i)   which UPI/account/wallet victim i was asked to pay
 */
export const CAMPAIGNS = [
  {
    code: 'kyc',
    c: 1,
    phones: 52,
    startDay: 29,
    endDay: 2,
    cities: ['Jamtara', 'Deoghar', 'Dhanbad', 'Ranchi', 'Kolkata'],
    upis: ['sbikyc.verify@axl', 'yono.update@ibl'],
    accounts: ['50100777120041', '50100777120042'],
    urls: ['https://sbi-kyc-update.in/verify', 'https://yono-sbi-kyc.top/login'],
    apks: ['SBI_KYC_Update.apk'],
    messages: [
      (x) => `Dear Customer your SBI YONO account will be blocked today. Update PAN KYC immediately at ${x.url} or call ${x.phone}`,
      (x) => `SBI: Aapka KYC expired ho gaya hai, account band ho jayega. Abhi update karein ${x.url} helpline ${x.phone}`,
      (x) => `प्रिय ग्राहक, आपका SBI खाता आज बंद हो जाएगा। केवाईसी अपडेट करने के लिए ${x.phone} पर कॉल करें या ${x.url} खोलें`,
      (x) => `KYC pending. Install https://sbi-kyc-update.in/${x.apk} and pay Rs 10 verification fee to ${x.upi} , support ${x.phone}`,
      (x) => `Your SBI netbanking is suspended. Pay KYC penalty Rs 1,499 to A/c no ${x.acct} IFSC ${IFSC} . Call ${x.phone} urgent`
    ],
    payout: (i, k) => k.accounts[i % 2]
  },
  {
    code: 'arrest',
    c: 2,
    phones: 46,
    startDay: 9,
    endDay: 0,
    cities: ['Mumbai', 'Pune', 'Bengaluru', 'Hyderabad', 'Chennai'],
    upis: [],
    accounts: ['31877400291'],
    urls: ['https://cbi-case-verify.in/warrant'],
    apks: [],
    messages: [
      (x) => `This is CBI officer. A FedEx parcel in your name was seized at customs with drugs. You are under digital arrest. Stay on video call ${x.phone} and transfer security deposit to A/c no ${x.acct} IFSC ${IFSC}`,
      (x) => `Mumbai Police Cyber Cell: money laundering case registered on your Aadhaar. Arrest warrant ${x.url} . Call ${x.phone} immediately, deposit to A/c no ${x.acct}`,
      (x) => `Customs department: aapka parcel seized hai, illegal items mile hain. CBI case band karne ke liye A/c no ${x.acct} me paise bhejo, call ${x.phone}`,
      (x) => `सीबीआई: आपके नाम पर मनी लॉन्ड्रिंग केस है। गिरफ्तार होने से बचने के लिए खाता no ${x.acct} में जमा करें, कॉल ${x.phone}`
    ],
    payout: (i, k) => k.accounts[0]
  },
  {
    code: 'bill',
    c: 3,
    phones: 35,
    startDay: 24,
    endDay: 4,
    cities: ['Surat', 'Ahmedabad', 'Vadodara', 'Rajkot'],
    upis: ['bijli.bill.pay@ybl'],
    accounts: ['50100333450017'],
    urls: ['https://mgvcl-bill-update.top/pay'],
    apks: ['Electricity_Bill_Update.apk'],
    messages: [
      (x) => `Dear consumer your electricity connection will be disconnected tonight at 9.30 pm as previous month bill was not updated. Contact electricity officer ${x.phone}`,
      (x) => `પ્રિય ગ્રાહક, આજે રાત્રે તમારું વીજળી કનેક્શન કાપી નાખવામાં આવશે. તુરંત ${x.phone} પર કૉલ કરો અને ${x.upi} પર બિલ ભરો`,
      (x) => `Bijli bill pending hai, light connection cut ho jayega. Update ke liye ${x.url} se ${x.apk} download karo, call ${x.phone}`,
      (x) => `Electricity bill update pending. Pay Rs 13 to ${x.upi} today itself to avoid disconnection. Officer ${x.phone}`
    ],
    payout: (i, k) => (i % 3 === 0 ? k.accounts[0] : k.upis[0])
  },
  {
    code: 'job',
    c: 4,
    phones: 38,
    startDay: 27,
    endDay: 1,
    cities: ['Hyderabad', 'Bengaluru', 'Chennai', 'Pune', 'Noida'],
    upis: ['task.reward@paytm', 'daily.earn@ybl', 'prepaid.task@axl'],
    accounts: ['50100444560091'],
    urls: ['https://earn-daily-task.vip/join'],
    apks: [],
    messages: [
      (x) => `Part time job: like YouTube videos and earn Rs 3000 daily. Work from home. WhatsApp HR ${x.phone} , register ${x.url}`,
      (x) => `Telegram task: prepaid task me Rs 1000 dalo, Rs 1500 wapas. Pay to ${x.upi} , mentor ${x.phone}`,
      (x) => `Congratulations you are selected for part-time work. Daily income Rs 5000. Security deposit to A/c no ${x.acct} IFSC ${IFSC} contact ${x.phone}`,
      (x) => `घर बैठे कमाई: वीडियो लाइक करो, रोज़ Rs 2000 कमाओ। अभी ${x.phone} पर मैसेज करो, फीस ${x.upi} पर भेजो`
    ],
    payout: (i, k) => (i % 4 === 2 ? k.accounts[0] : k.upis[i % 3])
  },
  {
    code: 'invest',
    c: 5,
    phones: 30,
    startDay: 30,
    endDay: 3,
    cities: ['Mumbai', 'Ahmedabad', 'Delhi', 'Bengaluru'],
    upis: ['nsevip.desk@ybl'],
    // The second account is the job ring's mule account: one WCC entity, two Louvain campaigns.
    accounts: ['50100555670023', '50100444560091'],
    urls: ['https://nse-vip-trade.app/register'],
    apks: ['NSE_VIP_Pro.apk'],
    wallets: ['TJAALDemoUsdtWa11etzzzzzzzzzzzzzzz'],
    messages: [
      (x) => `NSE VIP stock tips group: guaranteed returns 300% in IPO allotment. Join ${x.url} , mentor ${x.phone}`,
      (x) => `Install ${x.url.replace('/register', '')}/${x.apk} trading app. Deposit USDT TRC20 to wallet ${x.wallet} . Guaranteed profit. Assistant ${x.phone}`,
      (x) => `VIP group: aaj ka IPO allotment confirm. Rs 50,000 bhejo A/c no ${x.acct} IFSC ${IFSC} , trading app support ${x.phone}`,
      (x) => `Stock tips: double your money in 7 days. Pay subscription to ${x.upi} , WhatsApp ${x.phone}`
    ],
    payout: (i, k) => (i % 5 === 1 ? k.wallets[0] : i % 7 === 3 ? k.accounts[1] : i % 2 ? k.upis[0] : k.accounts[0])
  },
  {
    code: 'lottery',
    c: 6,
    phones: 25,
    intlPhones: ['+923001234567', '+923331234567', '+923451234567'],
    startDay: 21,
    endDay: 2,
    cities: ['Patna', 'Lucknow', 'Varanasi', 'Gaya'],
    upis: ['kbc.lottery.office@ybl'],
    accounts: ['31877600118'],
    urls: ['https://kbc-lucky-draw.online/claim'],
    apks: [],
    messages: [
      (x) => `KBC lucky draw: you have won Rs 25,00,000. To claim prize pay processing fee to ${x.upi} . Manager ${x.phone}`,
      (x) => `Kaun Banega Crorepati lottery winner! Aapka number select hua hai. Prize claim ${x.url} , call ${x.phone}`,
      (x) => `केबीसी लॉटरी: आपने 25 लाख का इनाम जीता है। टैक्स जमा करें खाता no ${x.acct} , संपर्क ${x.phone}`
    ],
    payout: (i, k) => (i % 2 ? k.accounts[0] : k.upis[0])
  },
  {
    code: 'refund',
    c: 7,
    phones: 61,
    startDay: 27,
    endDay: 0,
    cities: ['Delhi', 'Noida', 'Gurugram', 'Jaipur', 'Indore', 'Bhopal'],
    upis: ['refund.desk@ybl', 'refundcare.desk@axl'],
    accounts: ['50100777999061'],
    urls: [],
    apks: [],
    messages: [
      (x) => `Sir I sent Rs 5,000 to your number by mistake, please refund to ${x.upi} urgent. My number ${x.phone}`,
      (x) => `Galti se aapke account me paise chale gaye, please wapas bhej do ${x.upi} pe. Call me ${x.phone}`,
      (x) => `Your refund of Rs 2,340 is pending. Approve collect request from ${x.upi} and enter UPI PIN to receive. Support ${x.phone}`,
      (x) => `गलती से पैसे आपके खाते में भेजे गए, कृपया ${x.upi} पर वापस करें। मेरा नंबर ${x.phone}`
    ],
    // Every one of the 61 victims was told to pay refund.desk@ybl; some also got the second handle
    // or the account that both handles drain into.
    extra: (i, k) => [...(i % 5 === 0 ? [`also try ${k.upis[1]}`] : []), ...(i % 6 === 0 ? [`or A/c no ${k.accounts[0]} IFSC ${IFSC}`] : [])],
    payout: (i, k) => k.upis[0]
  },
  {
    code: 'anydesk',
    c: 8,
    phones: 22,
    startDay: 18,
    endDay: 1,
    cities: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Kochi'],
    upis: ['hdfc.care.refund@ybl'],
    accounts: ['50100888230077'],
    urls: ['https://hdfc-customer-care.support/help'],
    apks: [],
    messages: [
      (x) => `HDFC Bank customer care: to process your refund install AnyDesk and share the 9 digit code. Call ${x.phone}`,
      (x) => `Bank support: your card is blocked. Screen share via AnyDesk to unblock. Agent ${x.phone} , verify ${x.url}`,
      (x) => `Refund ke liye AnyDesk download karo aur code batao. Rs 1 bhejo ${x.upi} pe verify ke liye. Call ${x.phone}`
    ],
    payout: (i, k) => (i % 3 === 0 ? k.accounts[0] : k.upis[0])
  }
];

// The 2-hop story (digital arrest ring): a fresh number P was reported once alongside a handle M;
// the same reporter separately saw M paying into the ring's account B. B has 47 reports from
// independent victims (46 + that one), so P is 2 hops from 47 confirmed reports while P and M
// themselves stay "reported" (one reporter cluster).
export const BRIDGE = { phone: '9200099001', upi: 'case.closure@ybl' };

/** Yield report bodies in time order: { text, reporter, city, ts, campaign }. */
export function* demoReports(now = Date.now()) {
  const rnd = mulberry32(0x7a41);
  for (const k of CAMPAIGNS) {
    const phones = Array.from({ length: k.phones }, (_, i) => phone(k.c, i + 1)).concat(k.intlPhones || []);
    const n = phones.length;
    for (let i = 0; i < n; i++) {
      const progress = n === 1 ? 0 : i / (n - 1);
      const day = k.startDay - progress * (k.startDay - k.endDay);
      const ts = Math.round(now - day * DAY_MS - rnd() * 6 * 3_600_000);
      const city = k.cities[Math.min(k.cities.length - 1, Math.floor(progress * k.cities.length))];
      const payTo = k.payout(i, k);
      const ctx = {
        phone: phones[i].startsWith('+') ? phones[i] : fmtPhone(phones[i], rnd),
        upi: k.upis.includes(payTo) ? payTo : k.upis.length ? pick(k.upis, rnd) : undefined,
        acct: k.accounts.includes(payTo) ? payTo : k.accounts[0],
        wallet: k.wallets?.includes(payTo) ? payTo : k.wallets?.[0],
        url: pick(k.urls.length ? k.urls : [''], rnd),
        apk: pick(k.apks.length ? k.apks : [''], rnd)
      };
      let text = pick(k.messages, rnd)(ctx);
      const lang = /[ऀ-ॿ]/.test(text) ? 'hi' : /[઀-૿]/.test(text) ? 'gu' : 'en';
      // Every victim's message names the payout they were given; add the payment line if the template did not.
      if (!text.includes(payTo)) text = `${text} ${payLine(payTo, k, lang)}`;
      if (k.extra) text = [text, ...k.extra(i, k)].join(' ');
      yield { campaign: k.code, text, reporter: `demo-${k.code}-${i}`, city, ts, lang };
    }
  }
  const arrest = CAMPAIGNS.find((k) => k.code === 'arrest');
  const bridgeReporter = 'demo-arrest-bridge';
  yield {
    campaign: 'arrest',
    text: `Caller said he is from Delhi Police crime branch, case pending in your name. Pay case closure charges to ${BRIDGE.upi} , call back ${BRIDGE.phone}`,
    reporter: bridgeReporter, city: 'Pune', ts: now - 2 * DAY_MS, lang: 'en'
  };
  yield {
    campaign: 'arrest',
    text: `Same caller later sent: ${BRIDGE.upi} is linked to settlement A/c no ${arrest.accounts[0]} IFSC ${IFSC}`,
    reporter: bridgeReporter, city: 'Pune', ts: now - 2 * DAY_MS + 3_600_000, lang: 'en'
  };
}
