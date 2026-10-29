// Cake Wallet (and any wallet that reads standard payment URIs): Monero `monero:` URIs and
// BIP21 `bitcoin:` URIs, rendered as an inline SVG QR code.
// In production each customer gets a fresh Monero subaddress from monero-wallet-rpc
// (`create_address`), so payments are attributable without address reuse; set
// MONERO_WALLET_RPC_URL to enable that. Otherwise the configured base address is used.
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import { fetchWithTimeout } from '../util.js';

// Family Shield monthly price expressed in each asset (rounded; display only).
const AMOUNTS = { xmr: '0.0080', btc: '0.000015' };
const PLACEHOLDER = { xmr: 'DEMO-XMR-ADDRESS-SET-CAKE_XMR_ADDRESS', btc: 'DEMO-BTC-ADDRESS-SET-CAKE_BTC_ADDRESS' };

export class CakePay {
  constructor(cfg) {
    this.cfg = cfg;
  }

  get mode() {
    return this.cfg.xmr || this.cfg.btc ? 'live' : 'demo';
  }

  async #subaddress(label) {
    if (!this.cfg.moneroRpc) return null;
    try {
      const res = await fetchWithTimeout(`${this.cfg.moneroRpc}/json_rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'create_address', params: { account_index: 0, label } })
      }, 2000);
      const json = await res.json();
      return json.result?.address || null;
    } catch {
      return null;
    }
  }

  async paymentRequest(asset = 'xmr') {
    const a = asset === 'btc' ? 'btc' : 'xmr';
    const reference = `JAAL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const configured = this.cfg[a];
    const sub = a === 'xmr' && configured ? await this.#subaddress(reference) : null;
    const address = sub || configured || PLACEHOLDER[a];
    const amount = AMOUNTS[a];
    const uri =
      a === 'xmr'
        ? `monero:${address}?tx_amount=${amount}&tx_description=${encodeURIComponent(`JAAL Family Shield ${reference}`)}`
        : `bitcoin:${address}?amount=${amount}&label=JAAL&message=${encodeURIComponent(`Family Shield ${reference}`)}`;
    const qrSvg = await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0A0C0F', light: '#FBFAF7' } });
    return { asset: a, uri, address, amount, qrSvg, reference, subaddress: !!sub, demo: !configured };
  }
}
