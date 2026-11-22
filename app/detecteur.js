// Détecteur public : scan profond en direct → verdict gratuit → rapport complet contre email (lead).
(() => {
  const CAL = 'https://calendly.com/nicomalabre/30min?utm_source=detecteur';
  const DOT = { rouge: 'r', orange: 'o' };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const form = $('#st-form'), out = $('#st-out'), go = $('#st-go');
  let running = false;

  function setBar(u, live) { $('#bar-u').textContent = u; $('#bar-live').innerHTML = '<b></b>' + live; }

  function start(raw) {
    if (running) return;
    let u = String(raw || '').trim(); if (!u) return;
    running = true; go.disabled = true; go.textContent = 'Analyse…';
    const label = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
    setBar('analyse · ' + label, 'en cours');
    out.innerHTML = `<div class="st-report" style="margin-top:18px"><div class="st-log2" id="st-log"></div><div class="st-bar"><i id="st-p"></i></div><div class="timer" id="st-timer">Environ 2 minutes : je teste aussi le refus, l'acceptation et le panier. Restez sur la page.</div></div>`;
    setTimeout(() => { const i = $('#st-p'); if (i) { i.style.transition = 'width 140s cubic-bezier(.1,.6,.3,1)'; i.style.width = '94%'; } }, 60);
    const log = $('#st-log');
    const step = msg => { log.querySelectorAll('.ln .sp').forEach(s => { s.outerHTML = '<span class="tk">✓</span>'; }); const d = document.createElement('div'); d.className = 'ln'; d.innerHTML = '<span class="sp"></span>' + esc(msg); log.appendChild(d); };
    const t0 = Date.now(); const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); const el = $('#st-timer'); if (el) el.textContent = `${s} s écoulées · environ 2 minutes au total. Restez sur la page.`; }, 1000);
    const done = () => { running = false; go.disabled = false; go.textContent = 'Tester ma boutique'; clearInterval(tick); };
    const es = new EventSource('/api/public/scan?url=' + encodeURIComponent(u));
    es.addEventListener('step', e => step(JSON.parse(e.data).msg));
    es.addEventListener('result', e => { es.close(); done(); setBar('rapport · ' + label, 'testé à l’instant'); verdict(JSON.parse(e.data)); });
    es.addEventListener('fail', e => { es.close(); done(); setBar('détecteur · tracking', 'prêt'); let m = 'Je n’ai pas pu lire ce site.'; try { m = JSON.parse(e.data).error || m; } catch (_) {} errorCard(m); });
    es.onerror = () => { if (es.readyState === 2) return; es.close(); done(); if (!out.querySelector('.st-verdict')) errorCard('Le détecteur est occupé. Réessayez dans une minute : il ne traite qu’un test à la fois.'); };
  }

  function errorCard(msg) {
    out.innerHTML = `<div class="st-errcard st-report" style="margin-top:18px"><div class="ic">🚧</div><div class="t">${esc(msg)}</div><div class="sub">Certaines boutiques bloquent les robots. Dans ce cas, le détecteur le dit et n’affirme rien. Faisons le point ensemble sur votre tracking.</div><a class="btn btn-sm" href="${CAL}" target="_blank" rel="noopener">Réserver un diagnostic gratuit</a></div>`;
  }

  function verdict(d) {
    if (d.err) return errorCard(d.err);
    const n = d.nRouge + d.nOrange;
    const title = n ? `${d.nRouge ? d.nRouge + (d.nRouge > 1 ? ' pannes' : ' panne') : ''}${d.nRouge && d.nOrange ? ' + ' : ''}${d.nOrange ? d.nOrange + ' à renforcer' : ''}` : 'Rien à signaler sur ces contrôles';
    const shown = d.feux.slice(0, 3), hidden = d.feux.slice(3);
    out.innerHTML = `<div class="st-report" style="margin-top:18px">
      <div class="st-verdict ${n ? '' : 'ok'}"><div class="st-big">${n || 'OK'}</div><div><div class="st-vtitle">${esc(title)}</div><div class="st-vsub">${n ? 'Votre tracking perd de l’information. Voici où.' : 'Le détecteur ne voit pas les achats : cette partie se vérifie à la main.'}</div></div></div>
      ${d.outils.length ? `<div class="st-inv"><div class="st-inv-h">Ce que j’ai vu sur votre site</div><div class="st-chips">${d.outils.map(o => `<span class="st-chip">${esc(o)}</span>`).join('')}</div><div class="st-inv-sub">${d.cmp ? 'Consentement : ' + esc(d.cmp) : 'Aucun bandeau cookies détecté'}</div></div>` : ''}
      ${shown.map(f => `<div class="lamp"><span class="dot ${DOT[f.color]}"></span><div><b>${esc(f.phrase)}</b></div></div>`).join('')}
      ${hidden.map(f => `<div class="lamp blur-row" aria-hidden="true"><span class="dot ${DOT[f.color]}"></span><div><b>${esc(f.phrase.replace(/[A-Za-zÀ-ÿ]/g, 'x'))}</b></div></div>`).join('')}
      ${d.nOk ? `<div class="st-ok-head">Ce qui va bien : ${d.nOk} contrôle${d.nOk > 1 ? 's' : ''}</div>` : ''}
      <div class="leadbox">
        <h3>${n ? 'Recevez votre rapport complet' : 'Recevez votre rapport détaillé'}</h3>
        <ul class="unlock">
          ${hidden.length ? `<li>Les ${hidden.length} autre${hidden.length > 1 ? 's points' : ' point'} masqué${hidden.length > 1 ? 's' : ''} ci-dessus</li>` : ''}
          <li>La preuve de chaque panne : requête capturée, heure exacte</li>
          ${d.impactHigh ? `<li>Le calcul de ce que ça vous coûte sur votre budget pub (jusqu’à ${d.impactHigh} % de votre budget concerné)</li>` : ''}
          <li>Ce qu’il faut corriger, dans l’ordre</li>
        </ul>
        <form id="lead-form" novalidate>
          <div class="grid-f">
            <input class="inp" id="l-prenom" placeholder="Prénom" autocomplete="given-name" required aria-label="Prénom">
            <input class="inp" id="l-email" type="email" placeholder="Email professionnel" autocomplete="email" required aria-label="Email">
            <select class="inp full" id="l-budget" aria-label="Budget pub mensuel">
              <option value="">Votre budget pub mensuel (Meta + Google)</option>
              <option value="moins-2k">Moins de 2 000 €</option><option value="2k-5k">2 000 à 5 000 €</option><option value="5k-10k">5 000 à 10 000 €</option>
              <option value="10k-30k">10 000 à 30 000 €</option><option value="30k-plus">Plus de 30 000 €</option><option value="nsp">Je ne sais pas</option>
            </select>
          </div>
          <label class="consent"><input type="checkbox" id="l-consent"> J’accepte que Nicolas Malabre (Skill Tracking) me recontacte au sujet de ce rapport. Pas de newsletter, pas de revente.</label>
          <div class="lead-err" id="l-err"></div>
          <button class="btn" type="submit" style="width:100%;margin-top:6px" id="l-go">Voir mon rapport complet</button>
        </form>
      </div>
      <p class="fine center" style="margin-top:14px">Vous préférez en parler ? <a href="${CAL}" target="_blank" rel="noopener" style="color:var(--gold);text-decoration:none">Réserver un diagnostic gratuit</a></p>
    </div>`;
    $('#lead-form').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#l-err'), btn = $('#l-go');
      const payload = { token: d.token, prenom: $('#l-prenom').value, email: $('#l-email').value, budget: $('#l-budget').value, consent: $('#l-consent').checked };
      if (!payload.prenom.trim()) return (err.textContent = 'Indiquez votre prénom.');
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(payload.email.trim())) return (err.textContent = 'Adresse email invalide.');
      if (!payload.consent) return (err.textContent = 'Merci de cocher la case pour recevoir votre rapport.');
      btn.disabled = true; btn.textContent = 'Ouverture du rapport…'; err.textContent = '';
      try {
        const r = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Erreur');
        location.href = j.reportUrl;
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Voir mon rapport complet'; }
    });
  }

  form.addEventListener('submit', e => { e.preventDefault(); start($('#st-url').value); });
  const pre = new URLSearchParams(location.search).get('url');
  if (pre) { $('#st-url').value = pre; start(pre); }
})();
