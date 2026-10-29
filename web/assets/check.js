import { api, h, fmt, toast, copyText, chrome, deviceHash, ICON, TYPE_NOUN } from './lib.js';
import { mountLang, onLang, getLang, t } from './i18n.js';
import { VerdictCard } from './components/verdict-card.js';
import { RingCanvas } from './components/ring-canvas.js';
import { StateChip } from './components/state-chip.js';
import { DisputeLink } from './components/dispute-link.js';

chrome();
mountLang();

const $ = (id) => document.getElementById(id);
const q = $('q'), chips = $('chips'), foundLabel = $('foundLabel'), result = $('result'), go = $('go');

const EXAMPLES = {
  kyc: 'Dear customer, your SBI KYC has expired and your account will be blocked today. Pay Rs 10 verification fee to refund.desk@ybl or update at http://sbi-kyc-update.in/verify',
  intl: 'Hello sir, this is the courier office. Your parcel is held at customs. WhatsApp me on +923001234567 to release it.',
  friend: 'Sending you my share for dinner. My UPI is priya.sharma@okicici'
};

/* ---------- live, on-device extraction ---------- */
let current = [];
function renderChips() {
  const X = globalThis.JaalExtract;
  current = X ? X.extract(q.value) : [];
  chips.innerHTML = '';
  current.slice(0, 12).forEach((x) => {
    chips.append(h('span', { class: 'idchip', title: x.value }, h('b', { text: TYPE_NOUN[x.type] || x.type }), h('span', { text: x.value })));
  });
  foundLabel.dataset.i18n = current.length ? 'check.found' : 'check.none';
  foundLabel.textContent = t(foundLabel.dataset.i18n);
}
let raf = 0;
q.addEventListener('input', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderChips); });
q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('form').requestSubmit(); });

/* ---------- check ---------- */
let lastVerdict = null, lastText = '';
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = q.value.trim();
  if (!text) { q.focus(); return; }
  await runCheck(() => api('/check', { text, source: 'web', surface: 'manual', lang: getLang() }), text);
});

async function runCheck(fn, text) {
  lastText = text;
  go.disabled = true; go.setAttribute('aria-busy', 'true');
  result.setAttribute('aria-busy', 'true');
  result.innerHTML = '';
  result.append(h('div', { class: 'loading', 'aria-hidden': 'true' }));
  try {
    const v = await fn();
    showVerdict(v);
  } catch {
    result.innerHTML = '';
    result.append(h('p', { class: 'error-line', text: 'The graph did not answer. Check your connection and try again; nothing was saved.' }));
  } finally {
    go.disabled = false; go.removeAttribute('aria-busy'); result.setAttribute('aria-busy', 'false');
  }
}

function showVerdict(v) {
  lastVerdict = v;
  result.innerHTML = '';
  const primary = v.primary;
  const ms = Math.round(v.latencyMs || 0);
  const engine = v.engine === 'tigergraph' ? 'TigerGraph' : 'the graph';
  const meta = h('p', { class: 'engine' },
    h('span', {}, 'Answered in ', h('b', { text: `${ms} ms` }), ` from ${engine}`),
    v.stats && v.state !== 'clear' && v.stats.confirmedWithin2Hops ? [h('i', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text: `${v.stats.confirmedWithin2Hops} confirmed within 2 hops` })] : null,
    v.stats && v.stats.lastSeen ? [h('i', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text: `last reported ${fmt.ago(v.stats.lastSeen)}` })] : null);

  result.append(VerdictCard(v, { wide: true, source: primary ? `${TYPE_NOUN[primary.type] || primary.type} · ${primary.value}` : null, onAction }));
  result.append(meta);

  // secondary actions (the card carries at most two)
  const more = h('div', { class: 'more' });
  const has = (id) => (v.actions || []).some((a) => a.id === id);
  if (v.state !== 'clear') {
    const shareA = (v.actions || []).find((a) => a.id === 'share_family') || { id: 'share_family', label: 'Tell family' };
    more.append(btn('share', 'Share to family', () => onAction(shareA)));
    if (v.ring) more.append(btn('download', 'Download ring image', downloadRing));
  }
  if (v.state === 'clear' || has('report')) more.append(btn('flag', v.state === 'clear' ? 'Report as scam' : 'I got this too', report));
  if (more.childElementCount) result.append(more);
  if (v.state !== 'clear' && primary) result.append(DisputeLink(primary));

  // the ring
  if (v.ring && v.ring.nodes && v.ring.nodes.length > 1) {
    const c = v.campaign;
    const box = h('div', { class: 'ringbox dark' });
    box.append(RingCanvas(v.ring, { labels: true, animate: v.state === 'confirmed', pulse: v.state === 'confirmed' ? 3 : 0, style: null }));
    box.firstChild.classList.add('stage');
    const cap = h('div', { class: 'cap' });
    if (c) {
      cap.append(h('b', { text: c.name }), h('span', { class: 'caption lo', text: c.pattern }),
        h('div', { class: 'nums' },
          h('span', {}, h('strong', { text: fmt.n(c.size) }), ' identifiers in this ring'),
          h('span', {}, 'first seen ', h('strong', { text: `${fmt.days(c.firstSeen)} days` }), ' ago'),
          c.cities && c.cities.length ? h('span', { text: c.cities.join(' · ') }) : null),
        h('a', { href: `/ring.html?id=${encodeURIComponent(c.id)}`, class: 'caption' }, 'Open the full ring →'));
    } else {
      cap.append(h('span', { class: 'caption lo', text: `${v.ring.nodes.length} linked identifiers, ${v.ring.nodes.filter((n) => n.confirmed).length} confirmed. Not yet linked to a known campaign.` }));
    }
    box.append(cap);
    result.append(box);
  }

  // what was checked
  if (v.identifiers && v.identifiers.length) {
    const ul = h('ul', { class: 'idlist' });
    v.identifiers.forEach((x) => ul.append(h('li', {},
      h('span', { class: 'v', text: x.value }),
      h('span', { class: 't', text: `${TYPE_NOUN[x.type] || x.type}${x.reports ? ` · ${x.reports} report${x.reports === 1 ? '' : 's'}` : ''}` }),
      StateChip(x.state || 'clear'))));
    result.append(h('div', {}, h('p', { class: 'block-h', text: `What was checked (${v.identifiers.length})` }), ul));
  }
  if (v.signals && v.signals.length) {
    result.append(h('div', { class: 'signals' }, h('p', { class: 'block-h', text: 'Signals found on this device' }),
      h('ul', {}, v.signals.map((s) => h('li', { text: s.label })))));
  }
  result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function btn(icon, label, fn) {
  const b = h('button', { class: 'btn sm', type: 'button', html: ICON[icon] || '' });
  b.append(label);
  b.addEventListener('click', fn);
  return b;
}

async function onAction(a) {
  const v = lastVerdict;
  if (a.id === 'chakshu') {
    const ok = a.text ? await copyText(a.text) : false;
    if (a.href) window.open(a.href, '_blank', 'noopener');
    toast(ok ? 'Draft copied. Paste it into Chakshu; nothing was submitted for you.' : 'Opened Chakshu. Nothing was submitted for you.');
  } else if (a.id === 'call_1930') {
    location.href = a.href || 'tel:1930';
  } else if (a.id === 'bank_email' && a.href) {
    location.href = a.href;
  } else if (a.id === 'share_family') {
    const url = v && v.campaign ? `${location.origin}/ring.html?id=${encodeURIComponent(v.campaign.id)}` : location.origin + '/check.html';
    const text = a.text || (v ? `JAAL: ${v.headline}.` : 'JAAL');
    if (navigator.share) {
      try { await navigator.share({ title: 'JAAL', text, url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank', 'noopener');
  } else if (a.id === 'report') {
    report();
  }
}

async function downloadRing() {
  const v = lastVerdict;
  if (!v || !v.ring || !globalThis.JaalRing) return;
  await globalThis.JaalRing.downloadPNG(v.ring, {
    title: v.headline,
    subtitle: v.campaign ? `${v.campaign.name}: ${fmt.n(v.campaign.size)} identifiers, first seen ${fmt.days(v.campaign.firstSeen)} days ago.` : v.reason
  }, `jaal-${v.campaign ? v.campaign.id : v.id}.png`);
  toast('Ring image saved');
}

async function report() {
  const v = lastVerdict;
  try {
    const reporter = await deviceHash();
    const ids = v && v.identifiers ? v.identifiers.map(({ type, value }) => ({ type, value })) : undefined;
    const r = await api('/report', { text: lastText || undefined, identifiers: ids, reporter, verdict: 'scam', lang: getLang() });
    toast('Report added. Thank you — it counts once others confirm it.');
    if (r && r.verdict) showVerdict(r.verdict);
  } catch { toast('Could not send the report. Try again.'); }
}

/* ---------- examples ---------- */
document.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => {
  q.value = EXAMPLES[b.dataset.example] || '';
  renderChips();
  $('form').requestSubmit();
}));

/* ---------- voice ---------- */
const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const mic = $('mic'), vlang = $('voiceLang');
vlang.value = { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN' }[getLang()];
onLang((l) => { vlang.value = { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN' }[l]; });
if (!SR) {
  mic.disabled = true; mic.title = 'Voice needs Chrome or Edge';
  vlang.hidden = true;
} else {
  let rec = null;
  mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = vlang.value; rec.interimResults = true; rec.maxAlternatives = 1;
    let finalText = '';
    mic.setAttribute('aria-pressed', 'true'); $('micLabel').textContent = t('check.listening');
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      q.value = (finalText + interim).trim(); renderChips();
    };
    rec.onerror = (e) => { if (e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'Microphone permission was denied.' : 'Could not hear that. Try again.'); };
    rec.onend = () => {
      mic.setAttribute('aria-pressed', 'false'); $('micLabel').textContent = t('check.voice'); rec = null;
      const transcript = finalText.trim();
      if (transcript) runCheck(() => api('/voice', { transcript, lang: vlang.value.slice(0, 2) }), transcript);
    };
    rec.start();
  });
}

/* ---------- deep links: ?q= or ?example= ---------- */
const params = new URLSearchParams(location.search);
const pre = params.get('q') || EXAMPLES[params.get('example')];
const boot = () => {
  if (pre) { q.value = pre; renderChips(); $('form').requestSubmit(); } else renderChips();
};
if (globalThis.JaalExtract) boot(); else addEventListener('DOMContentLoaded', boot, { once: true });
