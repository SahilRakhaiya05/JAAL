// Wispr Flow speech-to-text adapter (WebSocket API, https://api-docs.wisprflow.ai/websocket_api).
// Flow takes 16 kHz mono 16-bit PCM WAV in ~1 s base64 packets: auth -> append -> commit,
// then streams { status: "text", final, body: { text } } messages.
// Without WISPR_API_KEY (Flow API access is invite-only) /api/voice uses the browser's
// SpeechRecognition transcript instead, and audio uploads get a clear 501.

const WS_URL = 'wss://platform-api.wisprflow.ai/api/v1/dash/ws';
const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
const TIMEOUT_MS = 10_000;

export class Wispr {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  get mode() {
    return this.apiKey ? 'live' : 'demo';
  }

  async transcribe(audio, lang = 'en') {
    if (!this.apiKey) throw httpError(501, 'Audio transcription needs WISPR_API_KEY; send { transcript } from the browser SpeechRecognition API instead.');
    if (typeof WebSocket === 'undefined') throw httpError(501, 'This Node runtime has no WebSocket client.');
    const pcm = pcmFromWav(audio);
    const packets = [];
    const volumes = [];
    for (let i = 0; i < pcm.length; i += BYTES_PER_SECOND) {
      const chunk = pcm.subarray(i, i + BYTES_PER_SECOND);
      packets.push(wavFromPcm(chunk).toString('base64'));
      volumes.push(rms(chunk));
    }
    if (!packets.length) throw httpError(400, 'Empty audio');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}?api_key=${encodeURIComponent(`Bearer ${this.apiKey}`)}`);
      let latest = '';
      const done = (err, text) => {
        clearTimeout(timer);
        try { ws.close(); } catch { /* already closed */ }
        if (err) reject(err);
        else resolve(text);
      };
      const timer = setTimeout(() => done(latest ? null : httpError(504, 'Wispr Flow timed out'), latest), TIMEOUT_MS);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', access_token: this.apiKey, language: [lang] }));
        ws.send(JSON.stringify({
          type: 'append',
          position: 0,
          audio_packets: { packets, volumes, packet_duration: 1.0, audio_encoding: 'wav', byte_encoding: 'base64' }
        }));
        ws.send(JSON.stringify({ type: 'commit', total_packets: packets.length }));
      };
      ws.onmessage = (msg) => {
        let data;
        try { data = JSON.parse(msg.data); } catch { return; }
        if (data.status === 'error' || data.error) return done(httpError(502, `Wispr Flow: ${data.message || data.error}`));
        if (data.status === 'text') {
          latest = data.body?.text || latest;
          if (data.final) done(null, latest);
        }
      };
      ws.onerror = () => done(httpError(502, 'Wispr Flow connection failed'));
      ws.onclose = () => done(latest ? null : httpError(502, 'Wispr Flow closed without a transcript'), latest);
    });
  }
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Validate a WAV upload and return its PCM payload. Flow requires 16 kHz mono int16. */
function pcmFromWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw httpError(415, 'Send audio as WAV (16 kHz, mono, 16-bit PCM).');
  }
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== SAMPLE_RATE || fmt.bits !== 16) {
        throw httpError(415, 'WAV must be 16 kHz, mono, 16-bit PCM.');
      }
      return buf.subarray(body, Math.min(buf.length, body + size));
    }
    offset = body + size + (size % 2);
  }
  throw httpError(415, 'WAV has no data chunk.');
}

function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function rms(pcm) {
  let sum = 0;
  const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return n ? Math.round(Math.sqrt(sum / n) * 1000) / 1000 : 0;
}
