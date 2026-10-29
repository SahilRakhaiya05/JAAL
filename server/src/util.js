import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DAY_MS = 86_400_000;
export const HALF_LIFE_DAYS = 21;
export const DEFAULT_WINDOW_DAYS = 90;

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomId = (prefix, bytes = 6) => `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Exponential decay with a 21-day half-life: an edge or report 21 days old weighs 0.5. */
export function decay(ts, now = Date.now(), halfLifeDays = HALF_LIFE_DAYS) {
  const ageDays = Math.max(0, (now - ts) / DAY_MS);
  return 0.5 ** (ageDays / halfLifeDays);
}

export const withinWindow = (ts, windowDays = DEFAULT_WINDOW_DAYS, now = Date.now()) => now - ts <= windowDays * DAY_MS;
export const iso = (ts) => (ts == null ? null : new Date(ts).toISOString());
export const daysAgo = (ts, now = Date.now()) => Math.max(0, Math.floor((now - ts) / DAY_MS));

/**
 * Salted hash for anything that could identify a person (device id, IP network).
 * The client already sends a salted device hash; we hash again with a server
 * salt so a leaked database cannot be joined against client-side ids.
 */
export const saltedHash = (salt, value) => sha256(`${salt}:${value}`).slice(0, 32);

/** Network part of an IP address: /24 for IPv4, /48 for IPv6. Used for reporter clustering. */
export function ipNetwork(ip = '') {
  const v4 = String(ip).replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.0/24';
  return String(ip).split(':').slice(0, 3).join(':') + '::/48';
}

/** JSON file with debounced, atomic writes (write tmp then rename). */
export class JsonFile {
  constructor(file, fallback, { persist = true, delayMs = 400 } = {}) {
    this.file = file;
    this.persist = persist;
    this.delayMs = delayMs;
    this.timer = null;
    this.data = fallback;
    if (fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        console.warn(`[jaal] could not parse ${file}: ${err.message}; starting empty`);
      }
    }
  }

  save() {
    if (!this.persist || this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
    this.timer.unref?.();
  }

  flush(data = this.data) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.persist) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }
}

/** fetch with a hard timeout; never throws on timeout, returns null instead. */
export async function fetchWithTimeout(url, opts = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
