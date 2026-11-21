// Skill Tracking — application (dashboard + détecteur live).
// Zéro dépendance en plus de playwright (déjà là pour le scan).
//   npm run app   →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns').promises;

const crypto = require('crypto');
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
// --- Hébergement (Cloud Run…) : tout est piloté par variables d'environnement ---
const DATA_DIR = process.env.DATA_DIR || ROOT;                 // dossier persistant (ex. bucket monté)
const GH_REPO = process.env.GITHUB_DATA_REPO || '';            // ex. nicomalabre-lab/skill-tracking-scanner → données du cron lues sur GitHub
const RADAR_PASSWORD = process.env.RADAR_PASSWORD || '';       // protège le Radar interne (prospects, notes)
const PUBLIC_ORIGINS = (process.env.PUBLIC_ORIGINS || 'https://skilltracking.fr,https://www.skilltracking.fr').split(',').map(x => x.trim()).filter(Boolean);
const PUBLIC_SCANS_PER_HOUR = Number(process.env.PUBLIC_SCANS_PER_HOUR) || 3;
try { fs.mkdirSync(path.join(DATA_DIR, 'reports'), { recursive: true }); } catch (_) {}
const PIPELINE = path.join(DATA_DIR, 'pipeline.json');
const CANDIDATES = path.join(DATA_DIR === ROOT ? ROOT : DATA_DIR, 'candidates.json');
if (DATA_DIR !== ROOT && !fs.existsSync(CANDIDATES)) { try { fs.copyFileSync(path.join(ROOT, 'candidates.json'), CANDIDATES); } catch (_) {} }
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

// ---- Données du cron : fichiers locaux, ou GitHub (10 min de cache) en mode hébergé ----
const ghCache = {};
async function repoJSON(rel, dflt) {
  if (!GH_REPO) return readJSON(path.join(ROOT, rel), dflt);
  const c = ghCache[rel];
  if (c && Date.now() - c.t < 600000) return c.v;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${GH_REPO}/main/${rel}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(r.status);
    const v = await r.json(); ghCache[rel] = { t: Date.now(), v }; return v;
  } catch (_) { return c ? c.v : readJSON(path.join(ROOT, rel), dflt); }
}

// ---- Rapports partageables ----
const newId = () => crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10);
function publicReport(rec) {   // ce que voit un prospect : pas de notes, pas de statut, payloads limités
  const x = { ...rec };
  delete x.deepErr;
  x.payloads = (rec.payloads || []).slice(0, 25);
  return x;
}
function saveReport(rec) {
  const id = rec.reportId || newId();
  rec.reportId = id;
  try { writeJSON(path.join(DATA_DIR, 'reports', id + '.json'), publicReport(rec)); } catch (_) {}
  return id;
}
async function loadReport(id) {
  if (!/^[A-Za-z0-9]{6,20}$/.test(id)) return null;
  const f = readJSON(path.join(DATA_DIR, 'reports', id + '.json'), null);
  if (f) return f;
  const full = await repoJSON('latest-full.json', []);      // rapports du scan quotidien (reportId déterministe)
  const r = full.find(x => x && x.reportId === id);
  return r ? publicReport(r) : null;
}

// ---- Auth du Radar interne (HTTP Basic, utilisateur libre, mot de passe = RADAR_PASSWORD) ----
function authed(req) {
  if (!RADAR_PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(RADAR_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const askAuth = res => { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Radar Skill Tracking", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Accès réservé'); };

// ---- Limite des scans publics (par IP) ----
const hits = new Map();
function allowPublic(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (arr.length >= PUBLIC_SCANS_PER_HOUR) return false;
  arr.push(now); hits.set(ip, arr); return true;
}
function cors(req, res) {
  const o = req.headers.origin;
  if (o && PUBLIC_ORIGINS.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'content-type'); }
}
// Format attendu par la page publique skilltracking.fr/detecteur (même contrat que l'ancien moteur)
function toDetectorFormat(rec, base) {
  return {
    ok: !rec.err || (rec.defects || []).length > 0, lisible: !rec.err || (rec.controles || []).length > 0,
    message: rec.err || null, url: rec.host,
    controles: (rec.controles || []).map(c => ({ code: c.code, color: c.color, phrase: c.phrase, preuve: c.preuve })),
    inventaire: { plateforme: rec.platform, outils: [...(rec.ga4Fire || []).length ? ['Google Analytics 4'] : [], ...(rec.fbFire || []).length ? ['Meta Pixel'] : [], ...(rec.awGads ? ['Google Ads'] : []), ...(rec.tt ? ['TikTok'] : []), ...(rec.pin ? ['Pinterest'] : []), ...(rec.otherAds || [])], cmp: rec.cmp && rec.cmp !== '?' ? rec.cmp : null, serverSide: !!((rec.serverGtmHost || []).length || (rec.firstPartyCollect || []).length || rec.stape) },
    impact: rec.impact || null,
    rapport: rec.reportId ? `${base}/r/${rec.reportId}` : null
  };
}
const baseUrl = req => process.env.PUBLIC_BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

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
  saveReport(rec);
  const log = readJSON(path.join(DATA_DIR, 'live-scans.json'), []);
  log.unshift(rec); writeJSON(path.join(DATA_DIR, 'live-scans.json'), log.slice(0, 100));
}

// ---- API ----
async function api(req, res, url) {
  const p = url.pathname;

  // ---------- PUBLIC ----------
  if (p === '/api/health') return send(res, 200, { ok: true, busy });
  const rm = p.match(/^\/api\/report\/([A-Za-z0-9]+)$/);
  if (req.method === 'GET' && rm) { const r = await loadReport(rm[1]); return r ? send(res, 200, r) : send(res, 404, { error: 'Rapport introuvable' }); }

  // ---------- PRIVÉ (Radar) ----------
  if (!authed(req)) return askAuth(res);

  if (req.method === 'GET' && p === '/api/data') {
    return send(res, 200, {
      mode: 'server', hosted: !!GH_REPO, publicBase: process.env.PUBLIC_BASE_URL || null,
      qualified: await repoJSON('qualified.json', []),
      full: await repoJSON('latest-full.json', []),
      index: await repoJSON('history/index.json', { days: [] }),
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

  if (req.method === 'GET' && p === '/api/live-scans') return send(res, 200, readJSON(path.join(DATA_DIR, 'live-scans.json'), []));

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
function file(res, f) { fs.readFile(f, (e, buf) => e ? send(res, 404, 'not found', 'text/plain') : send(res, 200, buf, MIME[path.extname(f)] || 'application/octet-stream')); }
const PUBLIC_ASSETS = new Set(['style.css', 'logo.png', 'rapport.js', 'rapport.html']);
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (/^\/r\/[A-Za-z0-9]+\/?$/.test(p)) return file(res, path.join(ROOT, 'app', 'rapport.html'));      // rapport public
  if (p.startsWith('/app/') && PUBLIC_ASSETS.has(p.slice(5))) return file(res, path.join(ROOT, 'app', p.slice(5)));
  if (!authed(req)) return askAuth(res);
  if (p === '/' || p === '/app') { res.writeHead(302, { Location: '/app/' }); return res.end(); }
  if (PUBLIC_JSON.has(p)) return file(res, path.join(ROOT, p));
  if (p.startsWith('/app/')) {
    let f = path.join(ROOT, 'app', p.slice(5));
    if (!f.startsWith(path.join(ROOT, 'app'))) return send(res, 403, 'forbidden', 'text/plain');
    if (p.endsWith('/')) f = path.join(f, 'index.html');
    return file(res, f);
  }
  return send(res, 404, 'not found', 'text/plain');
}

// API publique compatible avec la page skilltracking.fr/detecteur : POST /scan {url}
async function publicScan(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu' });
  if (busy) return send(res, 429, { ok: false, message: 'Le détecteur est occupé, réessayez dans une minute.' });
  if (!allowPublic(req)) return send(res, 429, { ok: false, message: 'Limite atteinte : quelques tests par heure maximum.' });
  const b = await body(req);
  const target = await normalizeUrl(b.url);
  const rec = await liveScan({ name: hostOf(target), url: target });
  logLive(rec);
  return send(res, 200, toDetectorFormat(rec, baseUrl(req)));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    if (url.pathname === '/scan') return await publicScan(req, res);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
    return serveStatic(req, res, url);
  } catch (e) {
    return send(res, 400, { ok: false, error: String(e.message || e).slice(0, 200), message: String(e.message || e).slice(0, 200) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Skill Tracking app → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
  const stop = async () => { try { if (browserP) (await browserP).close(); } catch (_) {} process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
module.exports = { server, normalizeUrl, isPrivateIP, toDetectorFormat, saveReport, loadReport };
