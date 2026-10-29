import { api, h, fmt, toast, copyText, chrome, ICON } from './lib.js';
import { mountLang, onLang, t } from './i18n.js';
import { CounterTile } from './components/counter-tile.js';
import { VerdictCard } from './components/verdict-card.js';
import { RingCanvas } from './components/ring-canvas.js';

chrome();
mountLang();

const ringReady = () => new Promise((res) => (globalThis.JaalRing ? res() : addEventListener('DOMContentLoaded', res, { once: true })));

/* ---------- live counters ---------- */
const TILES = [['users', 'c.users'], ['checks', 'c.checks'], ['identifiers', 'c.ids'], ['rings', 'c.rings'], ['paying', 'c.paying']];
const tiles = {};
const counters = document.getElementById('counters');
TILES.forEach(([k, key]) => { tiles[k] = CounterTile({ label: t(key), labelKey: key }); counters.append(tiles[k]); });
onLang(() => TILES.forEach(([k, key]) => { tiles[k].querySelector('.l').textContent = t(key); }));
const updatedEl = document.getElementById('updated');
let lastAt = 0;
async function pollStats() {
  try {
    const s = await api('/stats');
    TILES.forEach(([k]) => tiles[k].update(s[k]));
    lastAt = Date.now();
  } catch { /* keep last numbers */ }
}
setInterval(() => { if (lastAt) updatedEl.textContent = `updated ${Math.max(0, Math.round((Date.now() - lastAt) / 1000))}s ago`; }, 1000);
pollStats();
setInterval(() => { if (!document.hidden) pollStats(); }, 10000);

/* ---------- hero: live ring + overlay card ---------- */
function verdictFromRing(item, n = 61) {
  const ring = item.ring;
  const phones = ring.nodes.filter((x) => x.type === 'phone').length;
  const confirmed = ring.nodes.filter((x) => x.confirmed).length;
  const days = fmt.days(item.campaign.firstSeen);
  return {
    id: 'demo-' + item.campaign.id, state: 'confirmed',
    headline: `${n} people reported this UPI ID`,
    reason: `It pays into the same account as ${phones} numbers in a ring first seen ${days} days ago.`,
    ring, campaign: item.campaign,
    stats: { reports: n, confirmedWithin2Hops: confirmed },
    actions: [
      { id: 'chakshu', label: 'Draft Chakshu report' },
      { id: 'call_1930', label: 'Call 1930', href: 'tel:1930' }
    ]
  };
}
const demoAction = (a) => { if (a.id === 'chakshu') location.href = '/check.html?example=kyc'; };

(async () => {
  await ringReady();
  let top;
  try { [top] = await api('/rings/top?limit=1'); } catch { return; }
  if (!top) return;
  const stage = document.getElementById('heroRing');
  const size = Math.round(stage.getBoundingClientRect().width) || 600;
  globalThis.JaalRing.render(stage, top.ring, { size, pulse: 'loop' });
  const tn = document.getElementById('tickN'); if (tn) tn.textContent = top.ring.nodes.filter((x) => x.type === 'phone').length;
  const slot = document.getElementById('heroCard');
  setTimeout(() => {
    slot.append(VerdictCard(verdictFromRing(top), { source: 'WhatsApp', onAction: demoAction, pulse: 'loop' }));
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1100);

  // the payment card renders when scrolled into view, so its ring animation is seen
  const pay = document.getElementById('payCard');
  const io = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    io.disconnect();
    pay.append(VerdictCard(verdictFromRing(top), { source: 'Clipboard · payment app', onAction: demoAction }));
  }, { threshold: 0.35 });
  io.observe(pay.parentElement);

  // dev only: /?make-og writes web/og.png through the mock server
  if (new URLSearchParams(location.search).has('make-og')) {
    const out = await globalThis.JaalRing.exportPNG(top.ring, { title: 'JAAL watches for scam rings, so you don’t have to.', subtitle: 'Numbers rotate in days. Payout accounts stay for months. JAAL maps the ring before you pay.' });
    await fetch('/dev/save-og', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataUrl: out.dataUrl }) });
    toast('og.png written');
  }
})();

/* ---------- ring of the day ---------- */
(async () => {
  const list = document.getElementById('ringList');
  for (let i = 0; i < 3; i++) list.append(h('li', { class: 'skel', 'aria-hidden': 'true' }));
  let rows = [];
  try { rows = await api('/rings/top?limit=5'); } catch { list.innerHTML = '<li class="caption lo" style="padding:20px 0">The graph is not reachable right now.</li>'; return; }
  await ringReady();
  list.innerHTML = '';
  rows.forEach(({ campaign: c, ring }) => {
    const confirmed = ring.nodes.filter((n) => n.confirmed).length;
    const thumb = RingCanvas(ring, { compact: true, animate: false });
    thumb.className = 'thumb';
    const a = h('a', { href: `/ring.html?id=${encodeURIComponent(c.id)}` },
      thumb,
      h('div', {},
        h('div', { class: 'name', text: c.name }),
        h('div', { class: 'pat' }, c.pattern, c.demo ? h('span', { class: 'demo-tag', text: 'Demo data' }) : null),
        h('div', { class: 'nums num' },
          h('span', {}, h('b', { text: fmt.n(c.size) }), ' identifiers'),
          h('span', {}, h('b', { text: String(confirmed) }), ' confirmed'),
          h('span', {}, 'first seen ', h('b', { text: `${fmt.days(c.firstSeen)} days` }), ' ago'),
          c.cities && c.cities.length ? h('span', { text: c.cities.slice(0, 3).join(' · ') }) : null)),
      h('span', { class: 'go', html: ICON.arrow }));
    list.append(h('li', {}, a));
  });
})();

/* ---------- pricing ---------- */
document.getElementById('buyDodo').addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true; const label = b.textContent; b.textContent = 'Opening checkout…';
  try {
    const { checkoutUrl } = await api('/checkout/dodo', { plan: 'family_monthly' });
    location.href = checkoutUrl;
  } catch { toast('Checkout is not reachable right now. Try again in a minute.'); b.disabled = false; b.textContent = label; }
});

const sheet = document.getElementById('cryptoSheet');
async function loadCrypto(asset) {
  sheet.querySelectorAll('[data-asset]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.asset === asset)));
  const qr = document.getElementById('cryptoQr');
  qr.innerHTML = '';
  try {
    const r = await api('/pay/crypto?asset=' + asset);
    qr.innerHTML = r.qrSvg || '';
    document.getElementById('cryptoAmt').textContent = `${r.amount} ${asset.toUpperCase()}`;
    document.getElementById('cryptoRef').textContent = r.reference || '—';
    document.getElementById('cryptoAddrText').textContent = r.address;
    document.getElementById('cryptoOpen').href = r.uri;
  } catch { qr.innerHTML = '<p class="caption" style="color:#0A0C0F;padding:16px;text-align:center">Could not load a payment address.</p>'; }
}
document.getElementById('buyCrypto').addEventListener('click', () => { sheet.showModal(); loadCrypto('xmr'); });
document.getElementById('cryptoClose').addEventListener('click', () => sheet.close());
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
sheet.querySelectorAll('[data-asset]').forEach((b) => b.addEventListener('click', () => loadCrypto(b.dataset.asset)));
document.getElementById('cryptoAddr').addEventListener('click', async () => {
  if (await copyText(document.getElementById('cryptoAddrText').textContent)) toast('Address copied');
});
