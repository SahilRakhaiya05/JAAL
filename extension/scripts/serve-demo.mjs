// Static server for the demo pages: http://localhost:5174/demo/ (content scripts run here like on any site).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5174);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.exe': 'application/octet-stream' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '/demo') { res.writeHead(302, { location: '/demo/' }); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const abs = path.normalize(path.join(ROOT, p));
  if (!abs.startsWith(ROOT) || abs.includes('node_modules') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const ext = path.extname(abs).toLowerCase();
  const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' };
  if (ext === '.exe') headers['content-disposition'] = 'attachment; filename="AnyDesk.exe"';
  res.writeHead(200, headers);
  fs.createReadStream(abs).pipe(res);
}).listen(PORT, () => console.log(`JAAL demo: http://localhost:${PORT}/demo/`));
