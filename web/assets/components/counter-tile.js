// CounterTile: a live number with a subtle tick when it changes.
import { h, fmt } from '../lib.js';

export function CounterTile({ label, value = null, labelKey }) {
  const v = h('span', { class: 'v num', 'aria-hidden': 'true', text: value === null ? '—' : fmt.n(value) });
  const sr = h('span', { class: 'sr' });
  const l = h('span', { class: 'l', text: label, 'data-i18n': labelKey || null });
  const el = h('div', { class: 'ctile' }, v, sr, l);
  let cur = value;
  el.update = (next) => {
    if (next === null || next === undefined) return;
    sr.textContent = fmt.n(next);
    if (cur === null || matchMedia('(prefers-reduced-motion: reduce)').matches) { cur = next; v.textContent = fmt.n(next); return; }
    if (next === cur) return;
    const from = cur, start = performance.now(), dur = 700;
    cur = next;
    v.classList.remove('tick'); void v.offsetWidth; v.classList.add('tick');
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3);
      v.textContent = fmt.n(Math.round(from + (next - from) * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (value !== null) el.update(value);
  return el;
}
