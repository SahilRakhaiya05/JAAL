// Next-step actions attached to a verdict. Everything is a draft or a link the person
// opens themselves: nothing is ever submitted on their behalf.
import { actionLabel, nounOf } from './copy.js';
import { labelOf } from './graph/model.js';

export const CHAKSHU_URL = 'https://sancharsaathi.gov.in/sfc/';

const MEDIUM = { whatsapp_web: 'WhatsApp', telegram_web: 'Telegram', gmail: 'Email', notification: 'SMS / app notification', call: 'Phone call', voice: 'Phone call', clipboard: 'Message', paste: 'Message', page: 'Website', download: 'App download', manual: 'Message' };

function displayValue(primary) {
  return primary.type === 'bank_account' ? labelOf(`bank_account:${primary.value}`) : primary.value;
}

export function chakshuDraft({ primary, surface, campaign, people, checkId, identifiers }) {
  const lines = [
    `Medium: ${MEDIUM[surface] || 'Message'}`,
    `Date and time received: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    `Suspected number / handle / link: ${primary ? displayValue(primary) : 'see message'}`
  ];
  const others = (identifiers || []).filter((i) => !primary || i.key !== primary.key).slice(0, 5);
  if (others.length) lines.push(`Other identifiers in the message: ${others.map(displayValue).join(', ')}`);
  if (campaign) lines.push(`Pattern: ${campaign.pattern} (JAAL campaign ${campaign.id}, ${campaign.size} people reported)`);
  else if (people) lines.push(`${people} people have reported this ${nounOf(primary?.type)} on JAAL.`);
  lines.push(`JAAL reference: ${checkId}`);
  lines.push('Paste the original message below and attach a screenshot on the Chakshu form.');
  return lines.join('\n');
}

export function familyShareText({ primary, people, campaign, baseUrl, lang = 'en' }) {
  const what = primary ? `${nounOf(primary.type)} ${displayValue(primary)}` : 'message';
  const where = campaign?.cities?.length ? ` Seen in ${campaign.cities.slice(0, 3).join(', ')}.` : '';
  const count = people ? `${people} ${people === 1 ? 'person has' : 'people have'} reported the ${what} on JAAL.` : `Check the ${what} before paying.`;
  if (lang === 'hi') return `सावधान: ${people || 0} लोगों ने JAAL पर ${what} को रिपोर्ट किया है।${where} कोई भी नंबर यहाँ जाँचें: ${baseUrl}`; // NATIVE-REVIEW (hi)
  if (lang === 'gu') return `સાવધાન: ${people || 0} લોકોએ JAAL પર ${what}ની જાણ કરી છે.${where} કોઈપણ નંબર અહીં તપાસો: ${baseUrl}`; // NATIVE-REVIEW (gu)
  return `Heads-up: ${count}${where} Never share an OTP or UPI PIN to receive money. Check any number at ${baseUrl}`;
}

export function call1930Script({ primary }) {
  return [
    'Say: "I want to report a cyber financial crime and request a hold on the money."',
    'Have ready: amount paid, date and time, UTR / transaction ID from your UPI app,',
    `the receiving ${primary ? `${nounOf(primary.type)} (${displayValue(primary)})` : 'account or UPI handle'}, and your bank name.`,
    'Calling within the first hour gives the best chance of the money being frozen.'
  ].join(' ');
}

export function bankEmailDraft({ primary, checkId }) {
  return [
    'Subject: Request to block my card/UPI and raise a dispute for an unauthorised transaction',
    '',
    'Dear Sir/Madam,',
    '',
    `I was targeted by a scam on ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}. I request you to:`,
    '1. Block my UPI / card / net banking immediately.',
    '2. Raise a dispute for the transaction below and report the beneficiary account.',
    '',
    'Transaction amount: ₹____   Date/time: ____   UTR / reference: ____',
    `Beneficiary: ${primary ? displayValue(primary) : '____'}`,
    'Complaint number from 1930 / cybercrime.gov.in: ____',
    '',
    `Community reference: JAAL ${checkId}`,
    '',
    'Regards,',
    '[Your name, registered mobile, account last 4 digits]'
  ].join('\n');
}

/**
 * Ordered actions; clients show the first two (SPEC card: <= 2 actions).
 * On a call or with a first-time payee, 1930 comes first: minutes matter for freezing money.
 */
export function buildActions({ state, primary, surface, context = {}, campaign, people, checkId, identifiers, baseUrl, lang = 'en' }) {
  const L = (id) => actionLabel(id, lang);
  const valueParam = primary ? encodeURIComponent(primary.value) : '';
  const report = { id: 'report', label: L('report'), href: `${baseUrl}/check.html?q=${valueParam}` };
  if (state === 'clear') return [report];

  const share = familyShareText({ primary, people, campaign, baseUrl, lang });
  const actions = [
    { id: 'chakshu', label: L('chakshu'), href: CHAKSHU_URL, text: chakshuDraft({ primary, surface, campaign, people, checkId, identifiers }) },
    { id: 'share_family', label: L('share_family'), href: `https://wa.me/?text=${encodeURIComponent(share)}`, text: share },
    { id: 'call_1930', label: L('call_1930'), href: 'tel:1930', text: call1930Script({ primary }) },
    { id: 'bank_email', label: L('bank_email'), text: bankEmailDraft({ primary, checkId }) },
    report,
    { id: 'dispute', label: L('dispute'), href: `${baseUrl}/privacy.html?id=${valueParam}#dispute` }
  ];
  const urgent = context.onCall || context.firstTimePayee || surface === 'call' || surface === 'voice';
  if (urgent) actions.unshift(...actions.splice(2, 1));
  if (state === 'reported') return actions.filter((a) => a.id !== 'bank_email');
  return actions;
}
