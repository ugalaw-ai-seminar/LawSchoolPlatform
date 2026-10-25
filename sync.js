// Local HTTP bridge so the browser app shares ~/.loquitur/state.json with the agent tools.
// Listens on 127.0.0.1 only. The app (index.html) pulls and pushes the whole state here;
// every save bumps state.syncRev, and a push whose baseRev is stale gets a 409 with the
// current state so the app can merge and retry.

import http from 'node:http';
import * as store from './store.js';

export const SYNC_PORT = Number(process.env.LOQUITUR_SYNC_PORT) || 47811;

// file:// pages send Origin "null"; also allow pages served from this machine. Anything else
// (a website open in another tab) is refused, and the Host check blocks DNS rebinding.
const ALLOWED_ORIGIN = /^(null|https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$/;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${SYNC_PORT}`, `localhost:${SYNC_PORT}`]);
const MAX_BODY = 100 * 1024 * 1024;

function send(res, status, body, origin) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, PUT, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
    headers['access-control-allow-private-network'] = 'true';
    headers['vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const origin = req.headers.origin;
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'Forbidden host' });
  if (origin !== undefined && !ALLOWED_ORIGIN.test(origin)) return send(res, 403, { error: 'Forbidden origin' });
  if (req.method === 'OPTIONS') return send(res, 204, undefined, origin);

  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/rev') return send(res, 200, { rev: store.rev() }, origin);
  if (req.method === 'GET' && url.pathname === '/state') {
    const state = store.load();
    return send(res, 200, { rev: state.syncRev || 0, state }, origin);
  }
  if (req.method === 'PUT' && url.pathname === '/state') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Invalid JSON' }, origin); }
    if (!body || typeof body.state !== 'object' || !Array.isArray(body.state.courses)) return send(res, 400, { error: 'Missing state' }, origin);
    const current = store.load();
    if ((body.baseRev ?? -1) !== (current.syncRev || 0)) return send(res, 409, { rev: current.syncRev || 0, state: current }, origin);
    store.save(body.state);
    return send(res, 200, { rev: store.rev() }, origin);
  }
  return send(res, 404, { error: 'Not found' }, origin);
}

/** Start the bridge. If another LOQUITUR server already holds the port, it serves the same file, so just carry on. */
export function startSync() {
  const server = http.createServer((req, res) => handle(req, res).catch(e => send(res, 500, { error: e.message })));
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE'
      ? `[loquitur] Sync port ${SYNC_PORT} is already in use (probably another LOQUITUR server); using that one.`
      : `[loquitur] Sync server error: ${e.message}`);
  });
  server.listen(SYNC_PORT, '127.0.0.1');
  server.unref(); // never keep the process alive after the MCP client disconnects
  return server;
}
