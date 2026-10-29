// Shared page helpers: API, storage, device hash, toast, header, icons.

export async function api(path, body, { method } = {}) {
  const opts = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, opts);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem('jaal.' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jaal.' + k, v); } catch { /* private mode */ } }
};

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A random per-browser id, hashed with a fixed client salt. Never tied to a person. */
export async function deviceHash(kind = 'device') {
  let id = store.get(kind + '.id');
  if (!id) {
    id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    store.set(kind + '.id', id);
  }
  try { return await sha256('jaal-web-v1:' + id); } catch { return id; }
}

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

let toastEl, toastT;
export function toast(msg) {
  if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* no-op */ } ta.remove(); return ok;
  }
}

export const fmt = {
  n: (v) => Number(v || 0).toLocaleString('en-IN'),
  compact(v) {
    v = Number(v || 0);
    if (v >= 1e7) return (v / 1e7).toFixed(v >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' cr';
    if (v >= 1e5) return (v / 1e5).toFixed(v >= 1e6 ? 0 : 1).replace(/\.0$/, '') + ' L';
    return v.toLocaleString('en-IN');
  },
  ago(iso) {
    if (!iso) return '';
    const d = (Date.now() - Date.parse(iso)) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return Math.round(d / 60) + ' min ago';
    if (d < 86400) return Math.round(d / 3600) + ' h ago';
    return Math.round(d / 86400) + ' days ago';
  },
  date: (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '',
  days: (iso) => iso ? Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 86400e3)) : 0
};

export const TYPE_NOUN = { phone: 'number', upi: 'UPI ID', bank_account: 'bank account', ifsc: 'IFSC', url: 'link', domain: 'website', apk: 'app file', crypto: 'wallet', remote_app: 'remote app' };

export const ICON = {
  mark: '<svg viewBox="0 0 32 32" aria-hidden="true"><g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" opacity=".55"><path d="M16 16 16 6M16 16l10 6M16 16 6 22M16 6l10 16H6z"/></g><g fill="currentColor"><circle cx="16" cy="6" r="2.6"/><circle cx="26" cy="22" r="2.6"/><circle cx="6" cy="22" r="2.6"/><circle cx="16" cy="16" r="4"/></g></svg>',
  chrome: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5h8.2M8.9 13.8 4.8 6.6M15.1 13.8l-4.1 7.1"/></svg>',
  android: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>'
};

/** Sticky header border on scroll + language toggle wiring. */
export function chrome() {
  const top = document.querySelector('.top');
  if (top) {
    const on = () => top.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', on, { passive: true }); on();
  }
  document.querySelectorAll('[data-icon]').forEach((e) => { e.innerHTML = ICON[e.dataset.icon] || ''; });
}
