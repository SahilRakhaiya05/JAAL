import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const Core = require('../src/core.js');
const X = require('../../shared/extract.js');

const sha = (s) => createHash('sha256').update(s).digest('hex');

// ---------------- prefix hashing ----------------
test('sha256Hex matches node crypto', async () => {
  assert.equal(await Core.sha256Hex('upi:kyc.update@ybl'), sha('upi:kyc.update@ybl'));
  assert.equal(await Core.sha256Hex(''), sha(''));
});

test('hashIdentifiers uses canonical type:value keys and 8-hex prefixes (same as shared/extract)', async () => {
  const ids = X.extract('pay to kyc.update@ybl or call 98765 43210');
  const hashed = await Core.hashIdentifiers(ids);
  for (const h of hashed) {
    assert.equal(h.key, X.canonicalKey(h.type, h.value));
    assert.equal(h.hash, sha(h.key));
    assert.equal(h.prefix, X.hashPrefix(h.hash));
    assert.match(h.prefix, /^[0-9a-f]{8}$/);
  }
  assert.ok(hashed.some((h) => h.key === 'upi:kyc.update@ybl'));
  assert.ok(hashed.some((h) => h.key === 'phone:+919876543210'));
});

test('prefixHits finds only identifiers whose prefix is in the set (array or Set)', async () => {
  const hashed = await Core.hashIdentifiers([{ type: 'upi', value: 'a@ybl' }, { type: 'upi', value: 'b@ybl' }]);
  const list = [hashed[1].prefix, 'deadbeef'];
  assert.deepEqual(Core.prefixHits(list, hashed).map((h) => h.value), ['b@ybl']);
  assert.deepEqual(Core.prefixHits(new Set(list), hashed).map((h) => h.value), ['b@ybl']);
  assert.deepEqual(Core.prefixHits(null, hashed), []);
  assert.deepEqual(Core.prefixHits([], hashed), []);
});

test('makeDevice: random 32-byte id, reporter hash = sha256(salt:id), never the id itself', async () => {
  const a = await Core.makeDevice();
  const b = await Core.makeDevice();
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.match(a.salt, /^[0-9a-f]{32}$/);
  assert.equal(a.hash, sha(a.salt + ':' + a.id));
  assert.notEqual(a.hash, a.id);
  assert.notEqual(a.id, b.id);
});

// ---------------- triage gating ----------------
test('gate: ignore -> drop, check -> lookup, trigger -> check', () => {
  assert.equal(Core.gate(X.triage('see you at 5, bring the cake')), 'drop');
  assert.equal(Core.gate(null), 'drop');
  const weak = X.triage('Please send the amount to refund.desk@okaxis for order 4411, thanks');
  assert.equal(weak.level, 'check');
  assert.equal(Core.gate(weak), 'lookup');
  const strong = X.triage('Your KYC expired, account will be blocked today. Share the OTP immediately and pay Rs 10 to kyc.update@ybl');
  assert.equal(strong.level, 'trigger');
  assert.equal(Core.gate(strong), 'check');
});

test('afterLookup: only a prefix hit leaves the device', () => {
  assert.equal(Core.afterLookup(1, true), 'check');
  assert.equal(Core.afterLookup(0, true), 'drop');
  assert.equal(Core.afterLookup(0, false), 'drop');
});

test('pasteDecision: payables only; prefix hit or no list -> check', () => {
  assert.equal(Core.pasteDecision(0, 0, true), 'drop');
  assert.equal(Core.pasteDecision(1, 1, true), 'check');
  assert.equal(Core.pasteDecision(1, 0, true), 'drop');
  assert.equal(Core.pasteDecision(1, 0, false), 'check');
  const pay = Core.payables(X.extract('kyc.update@ybl https://example.com 98765 43210'));
  assert.deepEqual(pay.map((p) => p.type), ['upi']);
});

test('localVerdict lists matched patterns and is marked on-device', () => {
  const tri = X.triage('URGENT: your KYC update is pending. Share the OTP now or the account will be blocked');
  const v = Core.localVerdict(tri, 'whatsapp_web', 'en');
  assert.equal(v.state, 'local');
  assert.equal(v.engine, 'device');
  assert.match(v.headline, /^Matches \d+ scam patterns?$/);
  assert.match(v.reason, /asks for an OTP/);
  assert.ok(v.headline.split(/\s+/).length < 12, 'verdict line < 12 words');
  assert.ok(!/fraud/i.test(v.headline + v.reason), 'copy rule: never "fraud"');
  assert.ok(Core.shouldShow(v));
});

test('shouldShow: clear is silence', () => {
  assert.equal(Core.shouldShow({ state: 'clear' }), false);
  assert.equal(Core.shouldShow(null), false);
  assert.equal(Core.shouldShow({ state: 'reported' }), true);
  assert.equal(Core.shouldShow({ state: 'confirmed' }), true);
});

// ---------------- remote-app matcher ----------------
test('matchRemoteApp: installer filenames', () => {
  const cases = {
    'AnyDesk.exe': 'anydesk',
    'C:\\Users\\a\\Downloads\\AnyDesk (1).exe': 'anydesk',
    '/home/a/Downloads/TeamViewer_Setup_x64.exe': 'teamviewer',
    'TeamViewerQS.exe': 'quicksupport',
    'TeamViewer QuickSupport.apk': 'quicksupport',
    'AirDroid_Desktop_Client_3.7.2.exe': 'airdroid',
    'rustdesk-1.2.3-x86_64.msi': 'rustdesk',
    'UltraViewer_setup_6.6_en.exe': 'ultraviewer',
    'Ultra-Viewer.exe': 'ultraviewer',
    'anydesk': 'anydesk'
  };
  for (const [f, want] of Object.entries(cases)) assert.equal(Core.matchRemoteApp(f, [])?.id, want, f);
});

test('matchRemoteApp: URL path and vendor host, finalUrl too', () => {
  assert.equal(Core.matchRemoteApp('', ['https://cdn.example.net/files/AnyDesk.exe?x=1']).id, 'anydesk');
  assert.equal(Core.matchRemoteApp('', ['https://download.anydesk.com/latest']).id, 'anydesk');
  assert.equal(Core.matchRemoteApp('', ['https://dl.teamviewer.com/download/version_15x/']).id, 'teamviewer');
  assert.equal(Core.matchRemoteApp('', [null, 'https://x.example/RustDesk%20Setup.exe']).id, 'rustdesk');
  assert.equal(Core.matchRemoteApp('setup.exe', ['https://example.com/a', 'https://rustdesk.com/dl']).by, 'url');
});

test('matchRemoteApp: no false positives on documents or unrelated installers', () => {
  assert.equal(Core.matchRemoteApp('anydesk-user-guide.pdf', []), null);
  assert.equal(Core.matchRemoteApp('teamviewer-invoice.docx', []), null);
  assert.equal(Core.matchRemoteApp('ChromeSetup.exe', ['https://dl.google.com/chrome/ChromeSetup.exe']), null);
  assert.equal(Core.matchRemoteApp('', ['https://notanydesk.com.evil.example/file.zip']), null);
  assert.equal(Core.matchRemoteApp('', []), null);
});

// ---------------- message node helpers ----------------
test('isOutgoing recognises own messages across surfaces', () => {
  assert.equal(Core.isOutgoing({ className: 'focusable-list-item message-out' }), true);
  assert.equal(Core.isOutgoing({ dataId: 'true_919876543210@c.us_3EB0' }), true);
  assert.equal(Core.isOutgoing({ dataId: 'false_919876543210@c.us_3EB0' }), false);
  assert.equal(Core.isOutgoing({ className: 'bubble is-out' }), true);
  assert.equal(Core.isOutgoing({ className: 'Message own' }), true);
  assert.equal(Core.isOutgoing({ ancestorClassNames: 'x bubbles-group is-out' }), true);
  assert.equal(Core.isOutgoing({ ariaLabel: 'You: hello' }), true);
  assert.equal(Core.isOutgoing({ direction: 'out' }), true);
  assert.equal(Core.isOutgoing({ className: 'bubble is-in', direction: 'in' }), false);
  assert.equal(Core.isOutgoing({ className: 'ownership-banner' }), false, 'substring "own" is not a class match');
  assert.equal(Core.isOutgoing(null), false);
});

test('normalizeMessageText collapses whitespace, strips trailing time, caps length', () => {
  assert.equal(Core.normalizeMessageText('  Share   the OTP\n now\u00a0 10:42 pm'), 'Share the OTP now');
  assert.equal(Core.normalizeMessageText('Pay by 10:30 tomorrow ok'), 'Pay by 10:30 tomorrow ok');
  assert.equal(Core.normalizeMessageText('x'.repeat(5000)).length, Core.MAX_TEXT);
});

test('diffNewTexts returns only unseen texts and records them', () => {
  const seen = new Set();
  assert.deepEqual(Core.diffNewTexts(seen, ['Hello sir, customer care here', 'ok']), ['Hello sir, customer care here']);
  assert.deepEqual(Core.diffNewTexts(seen, ['Hello sir, customer care here 10:41', 'Share OTP to unblock account']), ['Share OTP to unblock account']);
  assert.equal(seen.has('Share OTP to unblock account'), true);
});

test('diffNewTexts skips a container whose text is just already-seen messages', () => {
  const seen = new Set();
  Core.diffNewTexts(seen, ['First message from the bank', 'Second message about the KYC']);
  assert.deepEqual(Core.diffNewTexts(seen, ['First message from the bank Second message about the KYC']), []);
  assert.deepEqual(Core.diffNewTexts(seen, ['First message from the bank and a brand new part with an OTP request']).length, 1);
});

test('diffNewTexts caps memory (LRU)', () => {
  const seen = new Set();
  const texts = Array.from({ length: 30 }, (_, i) => 'message number ' + i);
  Core.diffNewTexts(seen, texts, { max: 10 });
  assert.equal(seen.size, 10);
  assert.equal(seen.has('message number 29'), true);
  assert.equal(seen.has('message number 0'), false);
});

// ---------------- misc ----------------
test('badgeFor never relies on colour alone (text per state)', () => {
  assert.deepEqual(Core.badgeFor('confirmed', 61), { text: '!', color: '#E5484D' });
  assert.equal(Core.badgeFor('reported', 4).text, '4');
  assert.equal(Core.badgeFor('reported', 1000).text, '99+');
  assert.equal(Core.badgeFor('clear').text, '');
});

test('pushHistory keeps the newest 20', () => {
  let h = [];
  for (let i = 0; i < 25; i++) h = Core.pushHistory(h, { id: i });
  assert.equal(h.length, 20);
  assert.equal(h[0].id, 24);
});

test('normalizeApiBase', () => {
  assert.equal(Core.normalizeApiBase('http://localhost:8787/api/'), 'http://localhost:8787/api');
  assert.equal(Core.normalizeApiBase('localhost:8787'), null);
  assert.equal(Core.normalizeApiBase('javascript:alert(1)'), null);
});

test('strings exist for en/hi/gu with the same keys', () => {
  const en = Object.keys(Core.strings('en')).sort();
  assert.deepEqual(Object.keys(Core.strings('hi')).sort(), en);
  assert.deepEqual(Object.keys(Core.strings('gu')).sort(), en);
  assert.equal(Core.strings('xx'), Core.strings('en'));
});
