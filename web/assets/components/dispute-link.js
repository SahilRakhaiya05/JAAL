// DisputeLink: a quiet link that opens a small form -> POST /api/dispute.
import { h, api, toast } from '../lib.js';

export function DisputeLink(identifier, { label = 'This is mine. Dispute it' } = {}) {
  const wrap = h('div', { class: 'dispute' });
  const btn = h('button', { class: 'link', type: 'button', 'aria-expanded': 'false', text: label });
  wrap.append(btn);
  let form = null;
  btn.addEventListener('click', () => {
    if (form) { form.remove(); form = null; btn.setAttribute('aria-expanded', 'false'); return; }
    btn.setAttribute('aria-expanded', 'true');
    const id = 'd' + Math.random().toString(36).slice(2, 7);
    const reason = h('textarea', { class: 'input', id: id + 'r', rows: '3', required: true, maxlength: '500', placeholder: 'e.g. This is my shop’s UPI ID. I have never sent these messages.' });
    const contact = h('input', { class: 'input', id: id + 'c', type: 'text', maxlength: '120', autocomplete: 'off', placeholder: 'Optional: how we can reach you' });
    const submit = h('button', { class: 'btn primary', type: 'submit', text: 'Send dispute' });
    form = h('form', {},
      h('p', { class: 'caption lo', text: `Disputing ${identifier ? identifier.value : 'this identifier'}. Its reports are held for review while we look; nothing is shown as confirmed in the meantime.` }),
      h('div', { class: 'field' }, h('label', { for: id + 'r', text: 'Why is this wrong?' }), reason),
      h('div', { class: 'field' }, h('label', { for: id + 'c', text: 'Contact (optional)' }), contact),
      submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const r = await api('/dispute', { type: identifier && identifier.type, value: identifier && identifier.value, reason: reason.value.trim(), contact: contact.value.trim() || undefined });
        form.replaceWith(h('p', { class: 'caption lo', role: 'status', text: `Dispute ${r.disputeId || ''} received. Reports on it are on hold while it is reviewed.` }));
        btn.remove();
      } catch { submit.disabled = false; toast('Could not send. Try again.'); }
    });
    wrap.append(form);
    reason.focus();
  });
  return wrap;
}
