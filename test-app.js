// Tests de l'app : sécurité des URLs du détecteur + API de base (sans navigateur).
const assert = require('assert');
const http = require('http');
const { server, normalizeUrl, isPrivateIP, toDetectorFormat } = require('./server.js');
let pass = 0, fail = 0;
const check = async (label, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.log('  FAIL:', label, '-', e.message); } };
const rejects = async (p, re) => { let ok = false; try { await p; } catch (e) { ok = re.test(e.message); } assert(ok, 'devait être refusé'); };

function req(port, method, path, body) {
  return new Promise((ok, ko) => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json' } }, res => {
      let s = ''; res.on('data', c => s += c); res.on('end', () => ok({ code: res.statusCode, body: s }));
    });
    r.on('error', ko); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

(async () => {
  await check('IP privées détectées', () => { ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '::1'].forEach(ip => assert(isPrivateIP(ip), ip)); assert(!isPrivateIP('8.8.8.8')); });
  await check('localhost refusé', () => rejects(normalizeUrl('http://localhost:3000'), /interne/));
  await check('IP metadata refusée', () => rejects(normalizeUrl('http://169.254.169.254/'), /privée/));
  await check('file:// refusé', () => rejects(normalizeUrl('file:///etc/passwd'), /http|invalide/));
  await check('URL vide refusée', () => rejects(normalizeUrl(''), /manquante/));
  await check('schéma ajouté', async () => assert.strictEqual(await normalizeUrl('8.8.8.8/x'), 'https://8.8.8.8/x'));

  await check('format compatible skilltracking.fr/detecteur', () => {
    const f = toDetectorFormat({ host: 'x.fr', controles: [{ code: 'META_PRECONSENT', color: 'rouge', phrase: 'p', preuve: 'q', hook: 'h' }], fbFire: ['1'], cmp: 'Axeptio', reportId: 'abc123', impact: { low: 5, high: 10 } }, 'https://radar.skilltracking.fr');
    assert.strictEqual(f.lisible, true); assert.strictEqual(f.controles[0].color, 'rouge'); assert(!('hook' in f.controles[0]));
    assert.deepStrictEqual(f.inventaire.outils, ['Meta Pixel']); assert.strictEqual(f.rapport, 'https://radar.skilltracking.fr/r/abc123');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await check('GET /api/data', async () => { const r = await req(port, 'GET', '/api/data'); assert.strictEqual(r.code, 200); const j = JSON.parse(r.body); assert(Array.isArray(j.qualified) && j.index && Array.isArray(j.index.days)); });
  await check('GET /app/ sert la page', async () => { const r = await req(port, 'GET', '/app/'); assert.strictEqual(r.code, 200); assert(/Skill Tracking/.test(r.body)); });
  await check('path traversal bloqué', async () => { const r = await req(port, 'GET', '/app/../scan.js'); assert.notStrictEqual(r.code, 200); });
  await check('fichiers non publics bloqués', async () => { const r = await req(port, 'GET', '/package.json'); assert.strictEqual(r.code, 404); });
  await check('rapport public : id invalide refusé', async () => { const r = await req(port, 'GET', '/api/report/..%2F..%2Fpackage'); assert.notStrictEqual(r.code, 200); });
  await check('page rapport publique servie', async () => { const r = await req(port, 'GET', '/r/abc123XYZ'); assert.strictEqual(r.code, 200); assert(/rapport\.js/.test(r.body)); });
  await check('POST /scan vers IP privée refusé', async () => { const r = await req(port, 'POST', '/scan', { url: 'http://10.0.0.1' }); assert.strictEqual(r.code, 400); });
  await check('scan vers IP privée refusé', async () => { const r = await req(port, 'POST', '/api/scan', { url: 'http://127.0.0.1' }); assert.strictEqual(r.code, 400); });
  await check('statut pipeline inconnu refusé', async () => { const r = await req(port, 'PUT', '/api/pipeline', { host: 'x.fr', status: 'nimporte' }); assert.strictEqual(r.code, 400); });
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
