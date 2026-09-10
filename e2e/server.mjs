/* ==========================================================================
 * A zero-dependency static file server for the Playwright suite.
 *
 * The e2e fixtures load the library straight from source (`/src/wick-chart.js`)
 * and the shipped demo pages, so the browser needs the repository served over
 * http — `file://` would break ES module imports and CORS.
 *
 *   node e2e/server.mjs [port]
 *
 * Kept dependency-free on purpose: the package has no runtime dependencies and
 * the test harness should not be the thing that introduces one.
 * ========================================================================== */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || process.env.WICK_E2E_PORT || 5174);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  // Resolve inside ROOT — reject anything that climbs out via `..`.
  const path = normalize(join(ROOT, rel));
  if (!path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return send(res, 403, 'forbidden');
  try {
    const info = await stat(path);
    if (info.isDirectory()) return send(res, 404, 'not found');
    res.writeHead(200, {
      'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(res);
  } catch {
    send(res, 404, 'not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`e2e static server: http://127.0.0.1:${PORT}/ (root: ${ROOT})`);
});
