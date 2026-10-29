// ReasonLine: one plain sentence with numbers. Clamped to 2 lines visually, full text for screen readers.
import { h } from '../lib.js';

export function ReasonLine(text, { cls = 'reason' } = {}) {
  return h('p', { class: cls, text: text || '' });
}
