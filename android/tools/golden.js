// Regenerates app/src/test/resources/golden.json from the canonical JS extractor.
//   node android/tools/golden.js
const fs = require('fs');
const path = require('path');
const X = require('../../shared/extract.js');
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'samples.json'), 'utf8'));
const out = samples.map(function (s) {
  const r = X.triage(s.text, s.ctx || {});
  return {
    text: s.text,
    ctx: s.ctx || {},
    score: r.score,
    level: r.level,
    triggers: r.triggers.map(function (t) { return t.id; }),
    identifiers: r.identifiers.map(function (i) {
      const o = { type: i.type, value: i.value, raw: i.raw, key: i.key };
      if ('shortener' in i) o.shortener = i.shortener;
      if ('knownPsp' in i) o.knownPsp = i.knownPsp;
      if ('chain' in i) o.chain = i.chain;
      o.prefix = require('crypto').createHash('sha256').update(i.key).digest('hex').slice(0, 8);
      return o;
    })
  };
});
fs.writeFileSync(path.join(__dirname, '../app/src/test/resources/golden.json'), JSON.stringify(out, null, 1) + '\n');
out.forEach(function (o) { console.log(o.level.padEnd(7), String(o.score).padEnd(6), o.identifiers.map(function (i) { return i.key; }).join(' | ')); });
