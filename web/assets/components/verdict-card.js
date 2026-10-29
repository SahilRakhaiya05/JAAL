// VerdictCard: the one surface a verdict ever appears on (SPEC "Card").
//   clear     -> a quiet line, no fill, no actions
//   reported  -> 2px caution rule on the left, headline led by the count
//   confirmed -> 12% tint, ring thumbnail that animates, reason, ActionPair
import { h, ICON } from '../lib.js';
import { StateChip } from './state-chip.js';
import { ReasonLine } from './reason-line.js';
import { RingCanvas } from './ring-canvas.js';
import { ActionPair } from './action-pair.js';

export function VerdictCard(v, opts = {}) {
  const state = v && v.state ? v.state : 'clear';
  const hid = 'vh-' + (v.id || Math.random().toString(36).slice(2));
  const card = h('article', { class: 'vcard dark' + (opts.wide ? ' wide' : ''), 'data-state': state, 'aria-labelledby': hid });

  const row1 = h('div', { class: 'row1' }, StateChip(state));
  if (opts.source) row1.append(h('span', { class: 'src', text: opts.source }));
  card.append(row1);
  card.append(h('h3', { class: 'verdict', id: hid, text: v.headline || '' }));
  if (v.reason) card.append(ReasonLine(v.reason));

  if (state === 'confirmed' && v.ring && opts.ring !== false) {
    card.append(RingCanvas(v.ring, { compact: true, animate: opts.animate !== false, pulse: opts.pulse }));
  }
  if (state !== 'clear' && opts.actions !== false) {
    const acts = (v.actions || []).filter((a) => ['chakshu', 'call_1930', 'share_family', 'bank_email'].includes(a.id));
    if (acts.length) card.append(ActionPair(acts, opts.onAction));
  }
  if (opts.meta) card.append(h('div', { class: 'meta' }, ...[].concat(opts.meta)));
  if (opts.dismissible) {
    const x = h('button', { class: 'x', type: 'button', 'aria-label': 'Dismiss', html: ICON.close });
    x.addEventListener('click', () => {
      card.classList.add('leaving');
      setTimeout(() => { card.remove(); opts.onDismiss && opts.onDismiss(); }, 150);
    });
    card.append(x);
  }
  return card;
}
