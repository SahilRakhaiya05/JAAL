// JAAL extension build: copy shared libs, fonts, icons; validate manifest references; zip.
// Writes extension/lib, extension/fonts, extension/icons, extension/dist/jaal-extension.zip and ../web/extension.zip.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIcons } from './icons.mjs';
import { zip } from './zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = path.resolve(ROOT, '..', 'shared');
const WEB = path.resolve(ROOT, '..', 'web');
const rel = (...p) => path.join(ROOT, ...p);
const log = (...a) => console.log('[build]', ...a);

// 1. shared libraries
fs.mkdirSync(rel('lib'), { recursive: true });
for (const f of ['extract.js', 'tokens.css']) {
  const src = path.join(SHARED, f);
  if (!fs.existsSync(src)) throw new Error(`missing ../shared/${f}`);
  fs.copyFileSync(src, rel('lib', f));
  log('copied shared/' + f);
}
const ringSrc = path.join(SHARED, 'ring.js');
if (fs.existsSync(ringSrc)) {
  fs.copyFileSync(ringSrc, rel('lib', 'ring.js'));
  log('copied shared/ring.js');
} else {
  fs.writeFileSync(rel('lib', 'ring.js'), '/* shared/ring.js was not present at build time. JaalCard draws its built-in fallback ring. Re-run `npm run build` once it exists. */\n');
  log('shared/ring.js not found: wrote placeholder (fallback ring will be used)');
}

// 2. fonts (bundled; extension pages never fetch remote fonts)
const FONTS = {
  'inter-400.woff2': '@fontsource/inter/files/inter-latin-400-normal.woff2',
  'inter-600.woff2': '@fontsource/inter/files/inter-latin-600-normal.woff2',
  'deva-400.woff2': '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2',
  'deva-600.woff2': '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-600-normal.woff2',
  'gujr-400.woff2': '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff2',
  'gujr-600.woff2': '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-600-normal.woff2'
};
fs.mkdirSync(rel('fonts'), { recursive: true });
for (const [out, src] of Object.entries(FONTS)) {
  const p = rel('node_modules', src);
  if (fs.existsSync(p)) fs.copyFileSync(p, rel('fonts', out));
  else if (!fs.existsSync(rel('fonts', out))) log(`WARN font ${out} unavailable (run npm install); pages fall back to system fonts`);
}
for (const lic of ['@fontsource/inter/LICENSE', '@fontsource/noto-sans-devanagari/LICENSE']) {
  const p = rel('node_modules', lic);
  if (fs.existsSync(p)) fs.copyFileSync(p, rel('fonts', 'OFL-' + lic.split('/')[1] + '.txt'));
}
log('fonts ready');

// 3. icons
writeIcons();
log('icons rendered (16/32/48/128)');

// 4. manifest validation: every referenced file must exist
const manifest = JSON.parse(fs.readFileSync(rel('manifest.json'), 'utf8'));
const refs = new Set();
Object.values(manifest.icons || {}).forEach((p) => refs.add(p));
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach((p) => refs.add(p));
refs.add(manifest.background.service_worker);
if (manifest.side_panel) refs.add(manifest.side_panel.default_path);
if (manifest.options_page) refs.add(manifest.options_page);
(manifest.content_scripts || []).forEach((cs) => (cs.js || []).concat(cs.css || []).forEach((p) => refs.add(p)));
(manifest.web_accessible_resources || []).forEach((w) => w.resources.forEach((p) => refs.add(p)));
['lib/extract.js', 'src/core.js'].forEach((p) => refs.add(p)); // importScripts in background.js
const missing = [...refs].filter((p) => !fs.existsSync(rel(p)));
if (missing.length) throw new Error('manifest references missing files: ' + missing.join(', '));
if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
log(`manifest ok (${refs.size} referenced files present)`);

// 5. zip
const INCLUDE = ['manifest.json', 'background.js', 'README.md', 'PRIVACY.md', 'src', 'lib', 'pages', 'icons', 'fonts', 'demo'];
const entries = [];
function walk(p) {
  const abs = rel(p);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) fs.readdirSync(abs).sort().forEach((n) => walk(path.posix.join(p, n)));
  else entries.push({ name: p, data: fs.readFileSync(abs) });
}
INCLUDE.forEach(walk);
const buf = zip(entries);
fs.mkdirSync(rel('dist'), { recursive: true });
fs.writeFileSync(rel('dist', 'jaal-extension.zip'), buf);
log(`dist/jaal-extension.zip  ${entries.length} files, ${(buf.length / 1024).toFixed(1)} KB`);

// 6. the one allowed write outside extension/: the download for the website
try {
  fs.mkdirSync(WEB, { recursive: true });
  fs.writeFileSync(path.join(WEB, 'extension.zip'), buf);
  log('copied to ../web/extension.zip');
} catch (e) {
  log('WARN could not copy to ../web/extension.zip:', e.message);
}
