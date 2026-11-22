// Rapport public prospect : verdict, manque à gagner (calculateur), feux + preuves, CTA.
(() => {
  const COMEUP = 'https://comeup.com/fr/service/525192/reparer-un-bug-de-tracking-pixel-meta-google-ads-ou-ga4-sur-votre-site-en-48h';
  const CAL = 'https://calendly.com/nicomalabre/30min?utm_source=rapport';
  const DOT = { rouge: 'r', orange: 'o', vert: 'g', gris: 'x' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
  const root = document.getElementById('root');
  const id = (location.pathname.match(/\/r\/([A-Za-z0-9]+)/) || [])[1];
  // ?preview=1 : c'est Nicolas qui regarde depuis le Radar, on ne compte rien
  const preview = /[?&]preview=1/.test(location.search);
  const hot = /[?&]hot=1/.test(location.search);
  const track = (type, value) => {
    if (preview || !id) return;
    const data = JSON.stringify({ id, type, value });
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/event', new Blob([data], { type: 'text/plain' }))) return; } catch (_) {}
    fetch('/api/event', { method: 'POST', body: data, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  };

  const lamp = (c, conseq) => `<div class="lamp"><span class="dot ${DOT[c.color] || 'x'}"></span><div><b>${esc(c.phrase)}</b>${conseq && c.conseq ? `<div class="st-conseq">${esc(c.conseq)}</div>` : ''}${c.preuve ? `<div class="preuve">${esc(c.preuve)}</div>` : ''}</div></div>`;

  function render(r) {
    const tag = u => u + (u.includes('?') ? '&' : '?') + 'utm_source=rapport&utm_medium=radar&utm_campaign=' + encodeURIComponent(r.host || '') + '&utm_content=' + id;
    const CALr = tag(CAL.replace('?utm_source=rapport', '')), COMEUPr = COMEUP;
    document.title = `${r.host} · Rapport tracking · Skill Tracking`;
    const ctl = r.controles || [];
    const probs = ctl.filter(c => c.color === 'rouge' || c.color === 'orange');
    const oks = ctl.filter(c => c.color === 'vert' || c.color === 'gris');
    const nR = ctl.filter(c => c.color === 'rouge').length, nO = ctl.filter(c => c.color === 'orange').length;
    const imp = r.impact || { levers: [], low: 0, high: 0, inflated: [], legal: [] };
    const date = r.scannedAt ? new Date(r.scannedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const chips = [r.platform, ...(r.ga4Fire || []).length ? ['Google Analytics 4'] : [], ...(r.fbFire || []).length ? ['Pixel Meta'] : [], r.awGads && 'Google Ads', r.tt && 'TikTok', r.pin && 'Pinterest', r.snap && 'Snapchat', r.crit && 'Criteo', ...(r.otherAds || [])].filter(Boolean);

    root.innerHTML = `
    <section class="hero center">
      <div class="krow"><span class="eyebrow"><span>✦</span> Rapport tracking · ${esc(date)}</span></div>
      <h1>${esc(r.host)} : ${probs.length ? `votre tracking <em>perd de l'argent</em>` : `<em>rien à signaler</em> sur ces contrôles`}</h1>
      <p class="lead">J'ai ouvert votre boutique comme un visiteur : sans clic, puis en refusant les cookies, puis en les acceptant et en allant jusqu'au paiement. Voici ce qui part, ce qui se perd, et ce que ça vous coûte.</p>
    </section>

    ${imp.high > 0 ? `
    <div class="console" style="margin-bottom:18px">
      <div class="console-bar"><i></i><i></i><i></i><span class="u">manque à gagner · estimation</span><span class="live"><b></b>votre budget</span></div>
      <div class="console-body">
        <div class="mag">
          <div>
            <div class="st-inv-h">Performance publicitaire perdue chaque mois</div>
            <div class="big-eur" id="eur">—</div>
            <div class="st-vsub" style="margin-top:8px">soit <b style="color:#fff">${imp.low} à ${imp.high} %</b> de votre budget pub qui travaille sur des données incomplètes.</div>
          </div>
          <div>
            <div class="budget"><span>Votre budget pub mensuel (Meta + Google)</span><b id="bud">5 000 €</b></div>
            <input class="range" id="range" type="range" min="1000" max="100000" step="500" value="5000" aria-label="Budget publicitaire mensuel">
            <div class="fine">Déplacez le curseur. Calcul : effets moyens publiés par Meta et Google, combinés sans double compte.</div>
          </div>
        </div>
        <div style="margin-top:18px">${imp.levers.map(l => `<div class="lever"><div class="pct">${l.pct}%</div><div><b>${esc(l.label)}</b><div class="src">${esc(l.source)}${l.url ? ` · <a href="${esc(l.url)}" target="_blank" rel="noopener">source</a>` : ''}</div></div></div>`).join('')}</div>
        ${imp.inflated.length ? `<div class="alert"><b>Vos chiffres sont gonflés.</b> Des conversions sont comptées en double : vos ROAS affichés sont plus beaux que la réalité, et vos algorithmes apprennent sur du faux.</div>` : ''}
        ${imp.legal.length ? `<div class="alert"><b>Risque CNIL.</b> Des données partent sans l'accord du visiteur. Les sanctions concernent précisément ce cas.</div>` : ''}
        <p class="fine" style="margin-top:12px">${esc(imp.note)}</p>
      </div>
    </div>` : ''}

    <div class="console">
      <div class="console-bar"><i></i><i></i><i></i><span class="u">rapport · ${esc(r.host)}</span><span class="live"><b></b>${esc(date)}</span></div>
      <div class="console-body">
        <div class="st-verdict ${probs.length ? '' : 'ok'}"><div class="st-big">${probs.length || 'OK'}</div><div><div class="st-vtitle">${probs.length ? `${nR ? nR + (nR > 1 ? ' pannes' : ' panne') : ''}${nR && nO ? ' + ' : ''}${nO ? nO + ' à renforcer' : ''}` : 'Rien à signaler sur ces contrôles'}</div><div class="st-vsub">${probs.length ? 'Votre tracking perd de l’information. Voici où, avec la preuve.' : 'Le détecteur ne voit pas les achats : cette partie se vérifie à la main.'}</div></div></div>
        ${chips.length ? `<div class="st-inv"><div class="st-inv-h">Ce que j’ai vu sur votre site</div><div class="st-chips">${chips.map(c => `<span class="st-chip">${esc(c)}</span>`).join('')}</div><div class="st-inv-sub">${r.cmp && r.cmp !== '?' ? 'Consentement : ' + esc(r.cmp) : 'Aucun bandeau cookies détecté'}${(r.serverGtmHost || []).length || (r.firstPartyCollect || []).length || r.stape ? ' · <b>Tracking server-side détecté</b>' : ''}</div></div>` : ''}
        ${probs.map(c => lamp(c, true)).join('')}
        ${oks.length ? `<div class="st-ok-head">Ce qui va bien ou n'a pas pu être vérifié (${oks.length})</div>${oks.map(c => lamp(c, false)).join('')}` : ''}
        ${(r.payloads || []).length ? `<details class="more" data-ev-toggle="proofs"><summary>Preuves techniques : requêtes capturées (${r.payloads.length})</summary><div class="payloads">${r.payloads.map(p => `<b>[${esc(p.step)}] ${esc(p.method)} ${esc(p.vendor || p.kind)}</b>\n${esc(p.url)}${p.body ? '\n' + esc(String(p.body).slice(0, 400)) : ''}`).join('\n\n')}</div></details>` : ''}
        <div class="st-cta2" style="margin-top:22px;text-align:center">
          ${hot ? `<p class="st-push" style="font-size:15.5px;color:#e9e9e9;max-width:36em;margin:0 auto 14px;line-height:1.5">Avec votre budget, ces pannes vous coûtent cher. <b>Je vous offre 30 minutes</b> pour vous montrer quoi corriger en premier, preuves à l’écran.</p>
          <div class="cta-row" style="margin-top:0"><a class="btn" data-ev="calendly" href="${CALr}" target="_blank" rel="noopener">Réserver mon diagnostic offert</a>${probs.length ? `<a class="btn btn-ghost" data-ev="comeup" href="${COMEUPr}" target="_blank" rel="noopener">Corriger pour 35 €</a>` : ''}</div>` : `
          ${probs.length ? `<p class="st-push" style="font-size:15.5px;color:#e9e9e9;max-width:36em;margin:0 auto 14px;line-height:1.5">Je corrige ces points <b>sous 48h pour 35 €</b>, remboursé si je ne trouve rien à corriger.</p>` : ''}
          <div class="cta-row" style="margin-top:0">${probs.length ? `<a class="btn" data-ev="comeup" href="${COMEUPr}" target="_blank" rel="noopener">Corriger mon tracking →</a>` : ''}<a class="btn ${probs.length ? 'btn-ghost' : ''}" data-ev="calendly" href="${CALr}" target="_blank" rel="noopener">Réserver un diagnostic gratuit</a></div>`}
          <p style="margin-top:14px"><a data-ev="mailto" style="color:var(--gold);text-decoration:none;font-size:14px" href="mailto:nicolas@skilltracking.fr?subject=${encodeURIComponent('Rapport tracking ' + r.host)}">ou écrivez-moi</a></p>
        </div>
      </div>
    </div>
    <div style="height:50px"></div>`;

    // CTA de l'en-tête aussi
    const head = document.querySelector('.top .btn'); if (head) { head.href = CALr; head.dataset.ev = 'calendly'; }
    document.addEventListener('click', e => { const a = e.target.closest('[data-ev]'); if (a) track(a.dataset.ev); });
    document.querySelectorAll('[data-ev-toggle]').forEach(d => d.addEventListener('toggle', () => { if (d.open) track(d.dataset.evToggle); }, { once: true }));
    track('open');
    const range = document.getElementById('range');
    let budT = null, budSent = null;
    if (range) {
      const preB = +(new URLSearchParams(location.search).get('b') || 0);
      if (preB >= 1000 && preB <= 100000) { range.value = preB; budSent = preB; }
      range.addEventListener('input', () => { clearTimeout(budT); budT = setTimeout(() => { if (+range.value !== budSent) { budSent = +range.value; track('budget', budSent); } }, 1500); });
      const upd = () => { const b = +range.value; document.getElementById('bud').textContent = eur(b); document.getElementById('eur').innerHTML = `${eur(Math.round(b * imp.low / 100 / 50) * 50)} – ${eur(Math.round(b * imp.high / 100 / 50) * 50)}<small> / mois</small>`; };
      range.addEventListener('input', upd); upd();
    }
  }

  if (!id) { root.innerHTML = '<div class="empty">Lien de rapport invalide.</div>'; return; }
  fetch('/api/report/' + id).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(render)
    .catch(() => { root.innerHTML = '<div class="hero center"><div class="st-errcard"><div class="ic">🚧</div><div class="t">Rapport introuvable ou expiré.</div><div class="sub">Demandez un nouveau test sur <a href="https://skilltracking.fr/detecteur/" style="color:var(--gold)">skilltracking.fr/detecteur</a>.</div></div></div>'; });
})();
