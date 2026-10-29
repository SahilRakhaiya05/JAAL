// Behaviour for ring / privacy / guardian / extension / thanks pages.
import { api, h, fmt, toast, copyText, chrome, deviceHash, store } from './lib.js';
import { CounterTile } from './components/counter-tile.js';
import { VerdictCard } from './components/verdict-card.js';

chrome();
const page = document.querySelector('main[data-page]')?.dataset.page;
const $ = (id) => document.getElementById(id);
const whenRing = () => new Promise((r) => (globalThis.JaalRing ? r() : addEventListener('DOMContentLoaded', r, { once: true })));

/* ---------- ring.html?id= ---------- */
async function ringPage() {
  const id = new URLSearchParams(location.search).get('id');
  let data;
  try {
    data = id ? await api('/ring/' + encodeURIComponent(id)) : (await api('/rings/top?limit=1'))[0];
  } catch {
    $('rName').textContent = 'This ring is not in the graph any more.';
    $('rPattern').innerHTML = 'Rings fade after 90 days without new reports. <a href="/#rings">See today’s rings</a>.';
    return;
  }
  const { campaign: c, ring } = data;
  document.title = `${c.name} — a scam ring mapped by JAAL`;
  $('rCrumb').textContent = c.name;
  $('rName').textContent = c.name;
  $('rPattern').textContent = c.pattern;
  const confirmed = ring.nodes.filter((n) => n.confirmed).length;
  const stats = $('rStats');
  [[c.size, 'identifiers in the ring'], [confirmed, 'confirmed in this view'], [fmt.days(c.firstSeen), 'days since first seen'], [(c.cities || []).length, 'cities reporting']]
    .forEach(([v, l]) => stats.append(CounterTile({ label: l, value: v })));
  await whenRing();
  const stage = $('rStage');
  stage.setAttribute('aria-label', `Ring of ${ring.nodes.length} linked identifiers, ${confirmed} confirmed`);
  let ctl = globalThis.JaalRing.render(stage, ring, { labels: true, pulse: 3 });
  $('rReplay').addEventListener('click', () => { ctl.destroy(); ctl = globalThis.JaalRing.render(stage, ring, { labels: true, pulse: 3 }); });
  let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { ctl.destroy(); ctl = globalThis.JaalRing.render(stage, ring, { labels: true, animate: false }); }, 200); });
  const title = `${fmt.n(c.size)} identifiers, one ring: ${c.name}`;
  const subtitle = `First seen ${fmt.days(c.firstSeen)} days ago${c.cities && c.cities.length ? ` · ${c.cities.slice(0, 3).join(', ')}` : ''}. Check before you pay: jaal`;
  $('rDownload').addEventListener('click', async () => {
    await globalThis.JaalRing.downloadPNG(ring, { title, subtitle }, `jaal-${c.id}.png`);
    toast('Image saved');
  });
  $('rShare').addEventListener('click', async () => {
    const text = `${title}. Mapped by JAAL.`;
    try {
      if (navigator.share) {
        const out = await globalThis.JaalRing.exportPNG(ring, { title, subtitle });
        const file = out.blob && new File([out.blob], `jaal-${c.id}.png`, { type: 'image/png' });
        const payload = file && navigator.canShare && navigator.canShare({ files: [file] }) ? { files: [file], text, url: location.href } : { text, url: location.href };
        await navigator.share(payload); return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    if (await copyText(location.href)) toast('Link copied');
  });

  const list = $('rSpread');
  try {
    const rows = await api('/spread/' + encodeURIComponent(c.id));
    const max = Math.max(1, ...rows.map((r) => r.count));
    rows.forEach((r, i) => list.append(h('li', {},
      h('span', { class: 'i', text: String(i + 1).padStart(2, '0') }),
      h('span', {}, h('span', { class: 'city', text: r.city }), ' ', h('span', { class: 'when', text: `· first report ${fmt.date(r.firstSeen)}` })),
      h('span', { class: 'n', text: fmt.n(r.count) }),
      h('span', { class: 'track', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((r.count / max) * 100)}%;animation-delay:${i * 60}ms` })))));
    if (!rows.length) list.append(h('li', { class: 'caption lo', text: 'No city data yet.' }));
  } catch { list.append(h('li', { class: 'caption lo', text: 'Spread data is not available right now.' })); }
}

/* ---------- privacy.html dispute ---------- */
function privacyPage() {
  const f = $('disputeForm');
  const prefill = new URLSearchParams(location.search).get('id');
  if (prefill) $('dId').value = prefill;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('dId').value.trim();
    const X = globalThis.JaalExtract;
    const found = X ? X.extract(raw) : [];
    const id = found[0] || { type: /@/.test(raw) ? 'upi' : /^\+?\d[\d\s-]{7,}$/.test(raw) ? 'phone' : 'url', value: raw };
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      const r = await api('/dispute', { type: id.type, value: id.value, reason: $('dWhy').value.trim(), contact: $('dContact').value.trim() || undefined });
      $('dStatus').textContent = `Dispute ${r.disputeId || ''} received for ${id.value}. Its reports are on hold while we review.`;
      f.querySelectorAll('input, textarea').forEach((x) => (x.disabled = true));
    } catch { $('dStatus').textContent = 'Could not send. Try again in a minute.'; btn.disabled = false; }
  });
}

/* ---------- guardian.html ---------- */
function guardianPage() {
  const tabs = [[$('tabParent'), $('paneParent')], [$('tabGuardian'), $('paneGuardian')]];
  const select = (i) => tabs.forEach(([t, p], j) => { t.setAttribute('aria-selected', String(i === j)); p.hidden = i !== j; });
  tabs.forEach(([t], i) => t.addEventListener('click', () => select(i)));

  $('pairBtn').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const { code } = await api('/guardian/pair', { deviceHash: await deviceHash() });
      const box = $('code'); box.innerHTML = '';
      String(code).split('').forEach((d, i) => box.append(h('span', { text: d, style: `animation-delay:${i * 40}ms` })));
      box.setAttribute('aria-label', 'Pairing code ' + String(code).split('').join(' '));
      b.textContent = 'Show a new code';
    } catch { toast('Could not get a code. Try again.'); }
    b.disabled = false;
  });

  let timer = null;
  async function poll() {
    const wrap = $('alerts');
    try {
      const rows = await api('/guardian/alerts?guardianHash=' + encodeURIComponent(await deviceHash('guardian')));
      wrap.innerHTML = '';
      if (!rows.length) { wrap.append(h('div', { class: 'empty', text: 'No alerts. You will see a card here the moment a paired phone is shown a confirmed ring.' })); return; }
      rows.forEach(({ verdict, at }) => wrap.append(h('div', {},
        h('p', { class: 'alert-at', text: `Seen on the paired phone ${fmt.ago(at)}` }),
        VerdictCard(verdict, { wide: true, source: 'Paired phone', actions: false, pulse: 1 }))));
    } catch { /* keep last */ }
  }
  function startAlerts() {
    $('alertsWrap').hidden = false;
    poll(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) poll(); }, 15000);
  }
  $('linkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('codeIn').value.replace(/\D/g, '');
    if (code.length !== 6) { $('linkStatus').textContent = 'The code has 6 digits.'; return; }
    try {
      const r = await api('/guardian/link', { code, guardianHash: await deviceHash('guardian') });
      if (!r.ok) throw new Error('bad');
      store.set('guardian.linked', '1');
      $('linkStatus').textContent = 'Linked. Alerts from that phone will appear below.';
      startAlerts();
    } catch { $('linkStatus').textContent = 'That code did not match. Codes change each time they are shown.'; }
  });
  if (store.get('guardian.linked') === '1') { select(1); $('linkStatus').textContent = 'This phone is linked as a guardian.'; startAlerts(); }
}

/* ---------- extension.html ---------- */
function extensionPage() {
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    if (await copyText(b.dataset.copy)) toast('Copied. Paste it into the address bar.');
  }));
}

/* ---------- thanks.html ---------- */
function thanksPage() {
  if (new URLSearchParams(location.search).has('demo')) $('demoNote').hidden = false;
  store.set('plan', 'family_monthly');
}

({ ring: ringPage, privacy: privacyPage, guardian: guardianPage, extension: extensionPage, thanks: thanksPage })[page]?.();
