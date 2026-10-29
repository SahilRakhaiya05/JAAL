/* Mock data so extension pages render outside Chrome (?mock=1 or no chrome.runtime). Never used in the content scripts. */
(function (root) {
  'use strict';
  function ring() {
    var nodes = [{ id: 'u0', type: 'upi', label: 'kyc.update@ybl', hop: 0, reports: 61, confirmed: true }];
    var edges = [];
    var t1 = ['phone', 'phone', 'bank_account', 'upi', 'domain', 'phone', 'url', 'phone'];
    t1.forEach(function (t, i) {
      var id = 'h1-' + i;
      nodes.push({ id: id, type: t, label: t + ' ' + i, hop: 1, reports: [12, 4, 30, 2, 9, 1, 6, 3][i], confirmed: i === 2 || i === 4 });
      edges.push({ source: 'u0', target: id, type: 'MENTIONS' });
    });
    for (var j = 0; j < 14; j++) {
      var id2 = 'h2-' + j;
      nodes.push({ id: id2, type: j % 3 ? 'phone' : 'upi', label: 'n' + j, hop: 2, reports: j % 5, confirmed: j === 3 || j === 9 });
      edges.push({ source: 'h1-' + (j % 8), target: id2, type: 'PAYS_TO' });
    }
    return { center: 'u0', nodes: nodes, edges: edges };
  }
  var now = Date.now();
  var confirmed = {
    id: 'mock-confirmed', state: 'confirmed', confidence: 0.94, surface: 'whatsapp_web',
    headline: '61 people reported this UPI handle',
    reason: 'It pays into an account linked to 23 numbers in the KYC-update ring, first seen 9 days ago.',
    identifiers: [{ type: 'upi', value: 'kyc.update@ybl', state: 'confirmed', reports: 61 }, { type: 'phone', value: '+919876500011', state: 'reported', reports: 12 }],
    primary: { type: 'upi', value: 'kyc.update@ybl' },
    stats: { reports: 61, hopsToConfirmed: 0, confirmedWithin2Hops: 4, firstSeen: new Date(now - 9 * 864e5).toISOString(), lastSeen: new Date(now - 36e5).toISOString() },
    campaign: { id: 'c-kyc', name: 'KYC-update ring', size: 23, firstSeen: new Date(now - 9 * 864e5).toISOString(), pattern: 'kyc', cities: ['Jamtara', 'Pune'] },
    ring: ring(),
    signals: [{ id: 'kyc', label: 'KYC update pressure' }, { id: 'otp', label: 'Asks for an OTP' }],
    actions: [
      { id: 'chakshu', label: 'Report on Chakshu', href: 'https://sancharsaathi.gov.in/sfc/', text: 'Suspected fraud: UPI handle kyc.update@ybl asked for KYC update and OTP over WhatsApp.' },
      { id: 'call_1930', label: 'Call 1930', href: 'tel:1930' },
      { id: 'share_family', label: 'Share with family' },
      { id: 'dispute', label: 'Dispute' }
    ],
    latencyMs: 41, engine: 'memory', at: new Date(now - 5 * 6e4).toISOString(), snippet: 'Dear customer your KYC is pending, share OTP...'
  };
  var reported = {
    id: 'mock-reported', state: 'reported', confidence: 0.55, surface: 'paste',
    headline: '4 people reported this UPI handle',
    reason: 'Reports came from 2 cities in the last 6 days. Not yet linked to a confirmed ring.',
    identifiers: [{ type: 'upi', value: 'refund.desk@okaxis', state: 'reported', reports: 4 }],
    primary: { type: 'upi', value: 'refund.desk@okaxis' },
    stats: { reports: 4, hopsToConfirmed: 2, confirmedWithin2Hops: 0, firstSeen: null, lastSeen: null },
    campaign: null, ring: null, signals: [],
    actions: [{ id: 'call_1930', label: 'Call 1930', href: 'tel:1930' }, { id: 'dispute', label: 'Dispute' }],
    latencyMs: 30, engine: 'memory', at: new Date(now - 42 * 6e4).toISOString(), snippet: 'refund.desk@okaxis'
  };
  var local = root.JaalCore ? root.JaalCore.localVerdict({ score: 0.9, triggers: [{ id: 'otp', label: 'Asks for an OTP' }, { id: 'kyc', label: 'KYC update pressure' }, { id: 'urgent', label: 'Urgency pressure' }], identifiers: [] }, 'telegram_web', 'en') : null;
  if (local) { local.at = new Date(now - 3 * 36e5).toISOString(); local.snippet = 'URGENT: KYC expired, send OTP now'; }
  var question = { downloadId: 7, app: 'anydesk', label: 'AnyDesk', filename: 'AnyDesk.exe', at: new Date(now - 2 * 6e4).toISOString(), answer: null };
  var history = [confirmed, { id: 'dl-7', state: 'question', headline: 'Remote-access app: AnyDesk', surface: 'download', at: question.at }, reported, local,
    { id: 'mock-clear', state: 'clear', headline: 'No reports for this number', surface: 'manual', at: new Date(now - 5 * 36e5).toISOString() }].filter(Boolean);
  root.JaalMock = { confirmed: confirmed, reported: reported, local: local, question: question, history: history, ring: ring };
})(typeof globalThis !== 'undefined' ? globalThis : this);
