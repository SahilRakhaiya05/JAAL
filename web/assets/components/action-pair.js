// ActionPair: at most two 48px actions. First is primary.
import { h, ICON } from '../lib.js';

const ICONS = { call_1930: 'phone' };

export function ActionPair(actions = [], onAction = () => {}) {
  const list = actions.slice(0, 2);
  const wrap = h('div', { class: 'actions' + (list.length === 1 ? ' one' : '') });
  list.forEach((a, i) => {
    const isLink = a.href && /^tel:|^mailto:/.test(a.href);
    const el = h(isLink ? 'a' : 'button', {
      class: 'btn' + (i === 0 ? ' primary' : ''), type: isLink ? null : 'button', href: isLink ? a.href : null,
      'data-action': a.id
    });
    if (ICONS[a.id]) el.insertAdjacentHTML('afterbegin', ICON[ICONS[a.id]]);
    el.append(a.label);
    el.addEventListener('click', (e) => { if (!isLink) e.preventDefault(); onAction(a, e); });
    wrap.append(el);
  });
  return wrap;
}
