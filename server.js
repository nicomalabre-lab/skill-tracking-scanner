// Skill Tracking — application (dashboard + détecteur live).
// Zéro dépendance en plus de playwright (déjà là pour le scan).
//   npm run app   →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns').promises;

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PIPELINE = path.join(ROOT, 'pipeline.json');
const CANDIDATES = path.join(ROOT, 'candidates.json');
const STATUSES = ['a_contacter', 'contacte', 'relance', 'repondu', 'rdv', 'signe', 'perdu'];

const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const PUBLIC_JSON = new Set(['/qualified.json', '/latest-full.json', '/candidates.json', '/history/index.json']);

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return d; } };
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n');

function send(res, code, body, type = MIME['.json']) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function body(req, max = 1e5) {
  return new Promise((ok, ko) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > max) { ko(new Error('payload trop gros')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { ko(new Error('JSON invalide')); } });
  });
}

// ---- URL safety (the detector loads arbitrary URLs: refuse internal targets) ----
function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
}

async function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('URL manquante');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { if (!/^https?:\/\//i.test(s)) throw new Error('Seulement http(s)'); }
  else s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (_) { throw new Error('URL invalide'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Seulement http(s)');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error('Hôte interne refusé');
  if (net.isIP(u.hostname)) { if (isPrivateIP(u.hostname)) throw new Error('IP privée refusée'); }
  else {
    try {
      const addrs = await dns.lookup(u.hostname, { all: true });
      if (addrs.some(a => isPrivateIP(a.address))) throw new Error('Hôte interne refusé');
    } catch (e) { if (/refusé/.test(e.message)) throw e; /* DNS through proxy may fail: let the browser try */ }
  }
  return u.toString();
}

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; } };

// ---- Live scan (scan PROFOND) : un navigateur partagé, un scan à la fois ----
let browserP = null;
let queue = Promise.resolve();
let busy = false;
function liveScan(c, onStep) {
  const job = queue.then(async () => {
    busy = true;
    const { launch } = require('./scan.js');
    const { deepScan } = require('./deep.js');
    const { toRecord } = require('./controls.js');
    if (!browserP) browserP = launch().catch(e => { browserP = null; throw e; });
    const browser = await browserP;
    try {
      const raw = await withTimeout(deepScan(browser, c, { onStep }), 300000);
      return toRecord(raw);
    } catch (e) { browserP = null; try { await browser.close(); } catch (_) {} throw e; }
    finally { busy = false; }
  });
  queue = job.catch(() => {});
  return job;
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error('Scan trop long (> 5 min), abandonné')), ms))]);
function logLive(rec) {
  const log = readJSON(path.join(ROOT, 'live-scans.json'), []);
  log.unshift(rec); writeJSON(path.join(ROOT, 'live-scans.json'), log.slice(0, 100));
}

// ---- API ----
async function api(req, res, url) {
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/data') {
    return send(res, 200, {
      mode: 'server',
      qualified: readJSON(path.join(ROOT, 'qualified.json'), []),
      full: readJSON(path.join(ROOT, 'latest-full.json'), []),
      index: readJSON(path.join(ROOT, 'history', 'index.json'), { days: [] }),
      candidates: readJSON(CANDIDATES, []),
      pipeline: readJSON(PIPELINE, {}),
      statuses: STATUSES
    });
  }

  if (req.method === 'POST' && p === '/api/scan') {
    const b = await body(req);
    const target = await normalizeUrl(b.url);
    const rec = await liveScan({ name: (b.name || '').slice(0, 80) || hostOf(target), url: target });
    logLive(rec);
    return send(res, 200, rec);
  }

  // Scan profond avec étapes en direct (Server-Sent Events)
  if (req.method === 'GET' && p === '/api/scan/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const ev = (name, data) => { try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {} };
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
    try {
      const target = await normalizeUrl(url.searchParams.get('url'));
      if (busy) ev('step', { msg: 'Un autre scan est en cours, mise en file d\'attente…' });
      const rec = await liveScan({ name: (url.searchParams.get('name') || '').slice(0, 80) || hostOf(target), url: target }, (k, msg) => ev('step', { k, msg }));
      logLive(rec);
      ev('result', rec);
    } catch (e) { ev('fail', { error: String(e.message || e).slice(0, 200) }); }
    clearInterval(ping);
    return res.end();
  }

  if (req.method === 'GET' && p === '/api/live-scans') return send(res, 200, readJSON(path.join(ROOT, 'live-scans.json'), []));

  if (req.method === 'POST' && p === '/api/candidates') {
    const b = await body(req);
    const target = await normalizeUrl(b.url);
    const name = String(b.name || '').trim().slice(0, 80) || hostOf(target);
    const list = readJSON(CANDIDATES, []);
    if (list.some(c => hostOf(c.url) === hostOf(target))) return send(res, 409, { error: 'Marque déjà dans la liste' });
    list.push({ name, url: target });
    writeJSON(CANDIDATES, list);
    return send(res, 201, { ok: true, candidates: list });
  }

  if (req.method === 'DELETE' && p === '/api/candidates') {
    const h = hostOf(url.searchParams.get('url') || '');
    const list = readJSON(CANDIDATES, []);
    const next = list.filter(c => hostOf(c.url) !== h);
    writeJSON(CANDIDATES, next);
    return send(res, 200, { ok: true, removed: list.length - next.length, candidates: next });
  }

  if (req.method === 'PUT' && p === '/api/pipeline') {
    const b = await body(req);
    const host = String(b.host || '').slice(0, 120);
    if (!host) return send(res, 400, { error: 'host manquant' });
    if (b.status && !STATUSES.includes(b.status)) return send(res, 400, { error: 'statut inconnu' });
    const pl = readJSON(PIPELINE, {});
    const cur = pl[host] || {};
    pl[host] = { ...cur, ...(b.status ? { status: b.status } : {}), ...(typeof b.note === 'string' ? { note: b.note.slice(0, 2000) } : {}), updatedAt: new Date().toISOString() };
    writeJSON(PIPELINE, pl);
    return send(res, 200, { ok: true, entry: pl[host] });
  }

  return send(res, 404, { error: 'not found' });
}

// ---- Static ----
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '/app') { res.writeHead(302, { Location: '/app/' }); return res.end(); }
  let file;
  if (PUBLIC_JSON.has(p)) file = path.join(ROOT, p);
  else if (p.startsWith('/app/')) {
    file = path.join(ROOT, 'app', p.slice(5));
    if (!file.startsWith(path.join(ROOT, 'app'))) return send(res, 403, 'forbidden', 'text/plain');
    if (p.endsWith('/')) file = path.join(file, 'index.html');
  } else return send(res, 404, 'not found', 'text/plain');
  fs.readFile(file, (e, buf) => e ? send(res, 404, 'not found', 'text/plain') : send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream'));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
    return serveStatic(req, res, url);
  } catch (e) {
    return send(res, 400, { error: String(e.message || e).slice(0, 200) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Skill Tracking app → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
  const stop = async () => { try { if (browserP) (await browserP).close(); } catch (_) {} process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
module.exports = { server, normalizeUrl, isPrivateIP };
