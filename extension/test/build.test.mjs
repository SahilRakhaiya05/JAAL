import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, crc32 } from '../scripts/png.mjs';
import { zip } from '../scripts/zip.mjs';
import { renderIcon } from '../scripts/icons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('crc32 known vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('PNG encoder writes a valid header and decodable IDAT', () => {
  const png = encodePNG(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 1);
  const idatAt = png.indexOf('IDAT');
  const len = png.readUInt32BE(idatAt - 4);
  const raw = zlib.inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len));
  assert.deepEqual([...raw], [0, 255, 0, 0, 255, 0, 0, 255, 128]);
});

test('icon renderer: 16px icon is opaque brand in the middle of an edge, transparent in the corner', () => {
  const png = renderIcon(16);
  const idatAt = png.indexOf('IDAT');
  const raw = zlib.inflateSync(png.subarray(idatAt + 4, idatAt + 4 + png.readUInt32BE(idatAt - 4)));
  const px = (x, y) => raw.subarray(y * 65 + 1 + x * 4, y * 65 + 1 + x * 4 + 4);
  assert.equal(px(0, 0)[3] < 60, true, 'rounded corner');
  assert.deepEqual([...px(1, 8)], [0x6e, 0x5b, 0xff, 255]);
});

test('zip writer round-trips through the central directory', () => {
  const buf = zip([{ name: 'a.txt', data: Buffer.from('hello hello hello hello') }, { name: 'dir/b.bin', data: Buffer.from([1, 2, 3]) }]);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(buf.readUInt16LE(eocd + 10), 2);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < 2; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString();
    const lnlen = buf.readUInt16LE(off + 26);
    const body = buf.subarray(off + 30 + lnlen, off + 30 + lnlen + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    names.push([name, data.toString('hex')]);
    p += 46 + nlen;
  }
  assert.deepEqual(names, [['a.txt', Buffer.from('hello hello hello hello').toString('hex')], ['dir/b.bin', '010203']]);
});

test('manifest is MV3 with only the expected permissions', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual([...m.permissions].sort(), ['alarms', 'declarativeNetRequestWithHostAccess', 'downloads', 'notifications', 'sidePanel', 'storage', 'webNavigation'].sort());
  assert.equal(m.host_permissions, undefined, 'no install-time host permissions');
  assert.deepEqual(m.optional_host_permissions, ['<all_urls>']);
  assert.ok(m.side_panel.default_path);
  assert.ok(!/unsafe-eval|http/.test(m.content_security_policy.extension_pages), 'no remote code');
});
