// Builds history/index.json: a compact daily timeline used by the dashboard
// (trend chart, "nouveau" / "corrigé" badges). Run automatically after each scan,
// or by hand: `node build-index.js`.
const fs = require('fs');
const path = require('path');

function buildIndex(dir = path.join(__dirname, 'history')) {
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const days = files.map(f => {
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) {}
    const codes = {};
    const brands = rows.map(r => {
      const c = (r.defects || []).map(d => d.code);
      c.forEach(k => { codes[k] = (codes[k] || 0) + 1; });
      return { name: r.name, host: r.host, sev: r.top ? r.top.sev : 0, codes: c };
    });
    return {
      date: f.slice(0, 10),
      qualified: rows.length,
      sev5: brands.filter(b => b.sev >= 5).length,
      codes,
      brands
    };
  });
  const out = { generatedAt: new Date().toISOString(), days };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(out));
  return out;
}

module.exports = { buildIndex };
if (require.main === module) {
  const r = buildIndex();
  console.log(`history/index.json — ${r.days.length} jours`);
}
