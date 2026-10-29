// StateChip: word + icon shape per state (never colour alone).
// clear = circle outline, reported = triangle, confirmed = octagon.
import { h } from '../lib.js';

const SHAPES = {
  clear: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  reported: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.2 11 10.4H1z" fill="currentColor"/></svg>',
  confirmed: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 .8h4L11.2 4v4L8 11.2H4L.8 8V4z" fill="currentColor"/></svg>'
};
export const STATE_WORD = { clear: 'No reports', reported: 'Reported', confirmed: 'Confirmed ring' };

export function StateChip(state = 'clear', { word } = {}) {
  const s = SHAPES[state] ? state : 'clear';
  return h('span', { class: 'chip', 'data-state': s, html: SHAPES[s] }, h('span', { text: word || STATE_WORD[s] }));
}
