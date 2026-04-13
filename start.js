// start.js — QLang IDE static file server
//
// Sets Cross-Origin-Opener-Policy + Cross-Origin-Embedder-Policy headers
// required for SharedArrayBuffer (used by ext::input blocking stdin).
//
// Usage:  node start.js [port]
//         Default port: 3000

import { createServer }   from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join }  from 'node:path';
import { fileURLToPath }  from 'node:url';

const PORT = parseInt(process.argv[2] ?? '3000', 10);
const ROOT = fileURLToPath(new URL('.', import.meta.url));

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.wasm':  'application/wasm',
  '.json':  'application/json; charset=utf-8',
  '.md':    'text/markdown; charset=utf-8',
  '.qlang': 'text/plain; charset=utf-8',
  '.txt':   'text/plain; charset=utf-8',
};

createServer((req, res) => {
  const urlPath  = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = join(ROOT, urlPath);

  let stat;
  try { stat = statSync(filePath); } catch { stat = null; }

  if (!stat?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  res.writeHead(200, {
    'Content-Type':                'application/octet-stream',
    ...{ 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' },
    'Cross-Origin-Opener-Policy':  'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cache-Control':               'no-store, no-cache, must-revalidate',
    'Pragma':                      'no-cache',
    'Expires':                     '0',
  });

  createReadStream(filePath).pipe(res);
}).listen(PORT, () => {
  console.log(`QLang IDE →  http://localhost:${PORT}/`);
});
