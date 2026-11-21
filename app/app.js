// Skill Tracking — Radar (front). Deux modes :
//  - serveur : `npm run app` → détecteur profond en direct + pipeline enregistré dans pipeline.json
//  - lecture : hébergement statique → données du repo, pipeline gardé dans le navigateur
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CODE_LABEL = {
    META_PRECONSENT: 'Meta avant consentement', ADS_PRECONSENT: 'Régies pub avant consentement', ANALYTICS_PRECONSENT: 'Analytics avant consentement',
    REFUSE_IGNORED: 'Refus non respecté', REFUSE_BUTTON_MISSING: 'Pas de bouton Refuser', NO_CMP: 'Aucun bandeau cookies',
    GA4_PRECONSENT: 'GA4 avant consentement', CONSENT_GRANTED_DEFAULT: 'Consent « accordé » par défaut', CONSENT_MODE_MISSING: 'Consent Mode non branché',
    CONSENT_V2_INCOMPLETE: 'Consent Mode v2 incomplet', CONSENT_UPDATE_MISSING: 'Accord jamais transmis', ACCEPT_NO_MEASURE: 'Rien ne mesure après Accepter',
    DOUBLE_GA4: 'Double GA4', DOUBLE_META: 'Double pixel Meta', EVENT_DUPLICATED: 'Événement en double',
    VIEW_ITEM_MISSING: 'Vue produit non mesurée', ADD_TO_CART_MISSING: 'Ajout panier non mesuré', BEGIN_CHECKOUT_MISSING: 'Checkout non mesuré',
    ECOM_PARAMS: 'Valeur / devise manquantes', META_DEDUP: 'Pas d\'eid (dédup CAPI)', DL_SCHEMA: 'dataLayer non conforme', DL_NOT_SENT: 'dataLayer jamais envoyé',
    DL_UA_FORMAT: 'dataLayer format UA', JSONLD_PRODUCT: 'JSON-LD produit', LEGACY_UA: 'Universal Analytics', NO_SERVER_SIDE: 'Pas de server-side'
  };
  const STATUS_LABEL = { a_contacter: 'À contacter', contacte: 'Contacté', relance: 'Relancé', repondu: 'A répondu', rdv: 'RDV', signe: 'Signé', perdu: 'Perdu' };
  const DOT = { rouge: 'r', orange: 'o', vert: 'g', gris: 'x' };

  const S = { mode: 'static', qualified: [], full: [], index: { days: [] }, candidates: [], pipeline: {}, statuses: Object.keys(STATUS_LABEL), live: [] };

  // ---------- helpers ----------
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2300); }
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copié ✓'); } catch (_) { prompt('Copie manuelle :', text); } }
  async function getJSON(u) { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function call(method, u, body) {
    const r = await fetch(u, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  const ls = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const fmtDate = d => new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

  // Older (quick) records have no `controles`: derive lamps from defects.
  function controlsOf(r) {
    if (Array.isArray(r.controles) && r.controles.length) return r.controles;
    return (r.defects || []).map(d => ({ code: d.code, color: d.sev >= 4 ? 'rouge' : 'orange', sev: d.sev, phrase: CODE_LABEL[d.code] || d.code, preuve: d.evidence, hook: d.hook }));
  }

  // ---------- history-derived facts ----------
  function historyFacts() {
    const days = S.index.days || [];
    const last = days[days.length - 1], prev = days[days.length - 2];
    const prevHosts = new Set((prev?.brands || []).map(b => b.host));
    const curHosts = new Set((last?.brands || []).map(b => b.host));
    const streak = {};
    for (const h of curHosts) { let n = 0; for (let i = days.length - 1; i >= 0; i--) { if (days[i].brands.some(b => b.host === h)) n++; else break; } streak[h] = n; }
    const isNew = h => prev ? !prevHosts.has(h) : false;
    const fixed = prev ? prev.brands.filter(b => !curHosts.has(b.host)) : [];
    const appeared = last ? last.brands.filter(b => isNew(b.host)) : [];
    return { last, prev, streak, isNew, fixed, appeared };
  }

  // ---------- outbound ----------
  const reportUrl = r => r.reportId ? `${S.publicBase || location.origin}/r/${r.reportId}` : null;
  function emailE1(r) {
    const ctl = controlsOf(r).filter(c => c.sev);
    const top = r.top || ctl[0];
    const others = ctl.filter(c => c.code !== top.code).slice(0, 2);
    const extra = others.length ? `\n\nEt ce n'est pas le seul point : ${others.map(c => c.phrase.replace(/\.$/, '').toLowerCase()).join(' ; ')}.` : '';
    const imp = r.impact && r.impact.high > 0 ? `\n\nOrdre de grandeur : ${r.impact.low} à ${r.impact.high} % de votre budget pub travaille sur des données incomplètes (d'après les chiffres publiés par Meta et Google).` : '';
    const link = reportUrl(r) ? `\n\nLe rapport complet, avec les preuves et le calcul sur votre budget : ${reportUrl(r)}` : `\n\nJ'ai les preuves (requêtes observées, horodatées). Je vous les envoie ?`;
    return `Objet : ${r.name} — une panne de tracking repérée sur votre site\n\nBonjour,\n\nJ'ai passé ${r.host} au détecteur de pannes de tracking : il ouvre la boutique comme un visiteur, refuse puis accepte les cookies, et va jusqu'au panier.\n\n${top.hook}${extra}${imp}${link}\n\nJe corrige ce type de panne sous 48h.\n\nBonne journée,\nNicolas — Skill Tracking\nhttps://skilltracking.fr`;
  }

  // ---------- rendering ----------
  function inventory(r) {
    const chips = [];
    if (r.platform) chips.push([r.platform, '']);
    (r.ga4Fire || []).forEach(id => chips.push(['GA4 ' + id, '']));
    (r.gtmIds || []).forEach(id => chips.push([id, '']));
    if (r.fbFire?.length) chips.push([`Meta ×${r.fbFire.length}`, '']);
    [['awGads', 'Google Ads'], ['tt', 'TikTok'], ['pin', 'Pinterest'], ['snap', 'Snapchat'], ['crit', 'Criteo']].forEach(([k, l]) => r[k] && chips.push([l, '']));
    (r.otherAds || []).forEach(v => chips.push([v, '']));
    (r.analytics || []).forEach(v => chips.push([v, 'dim']));
    (r.uaFire || []).forEach(id => chips.push(['UA ' + id, 'bad']));
    const sub = [];
    if (r.cmp && r.cmp !== '?') sub.push('Consentement : ' + esc(r.cmp));
    else sub.push('Consentement : aucun bandeau détecté');
    const ss = r.serverGtmHost?.length || r.firstPartyCollect?.length || r.stape;
    if (ss) sub.push('<b>Tracking server-side détecté</b>');
    return `<div class="st-inv"><div class="st-inv-h">Ce que j'ai vu sur le site</div><div class="st-chips">${chips.map(([t, c]) => `<span class="st-chip ${c}">${esc(t)}</span>`).join('') || '<span class="st-chip dim">aucun outil Google ou Meta</span>'}</div><div class="st-inv-sub">${sub.join(' · ')}</div></div>`;
  }

  function parcours(r) {
    if (!r.parcours) return '';
    const P = r.parcours;
    const it = (v, l) => v === null || v === undefined ? '' : `<span class="${v ? 'ok' : 'ko'}"><i></i>${l}</span>`;
    return `<div class="parcours">${it(P.refus, 'Refuser')}${it(P.acceptation, 'Accepter')}${it(!!P.produit, 'Fiche produit')}${it(P.panier, 'Ajout panier')}${it(P.checkout, 'Paiement')}${r.durationS ? `<span>${r.durationS} s</span>` : ''}</div>`;
  }

  function lamp(c, withConseq) {
    return `<div class="lamp"><span class="dot ${DOT[c.color] || 'x'}"></span><div><b>${esc(c.phrase)}</b>${withConseq && c.conseq ? `<div class="st-conseq">${esc(c.conseq)}</div>` : ''}${c.preuve ? `<div class="preuve">${esc(c.preuve)}</div>` : ''}</div></div>`;
  }

  function payloadsBlock(r) {
    if (!r.payloads?.length) return '';
    const rows = r.payloads.slice(0, 40).map(p => `<b>[${esc(p.step)}] ${esc(p.method)} ${esc(p.vendor || p.kind)}</b>${p.mime ? ' · ' + esc(p.mime) : ''}\n${esc(p.url)}${p.body ? '\n' + esc(p.body.slice(0, 600)) : ''}`).join('\n\n');
    return `<details class="more"><summary>Payloads capturés (${r.payloads.length}) · ${esc((r.endpoints || []).length)} endpoints</summary><div class="payloads">${rows}</div></details>`;
  }

  function card(r, opts = {}) {
    const f = opts.facts;
    const ctls = controlsOf(r);
    const probs = ctls.filter(c => c.color === 'rouge' || c.color === 'orange');
    const oks = ctls.filter(c => c.color === 'vert' || c.color === 'gris');
    const nR = ctls.filter(c => c.color === 'rouge').length, nO = ctls.filter(c => c.color === 'orange').length;
    const p = S.pipeline[r.host] || {};
    const pills = [
      f && f.isNew(r.host) ? '<span class="pill new">Nouveau</span>' : '',
      f && f.streak[r.host] > 1 ? `<span class="pill" title="jours consécutifs avec panne">${f.streak[r.host]} j en panne</span>` : '',
      r.deep ? '<span class="pill deep">scan profond</span>' : '',
      r.err && !probs.length ? '<span class="pill red">site illisible</span>' : '',
      r.runsAds ? '<span class="pill">fait de la pub</span>' : '',
      r.impact && r.impact.high > 0 ? `<span class="pill red" title="Part du budget pub qui travaille sur des données incomplètes (Meta / Google)">manque à gagner ${r.impact.low}–${r.impact.high} %</span>` : ''
    ].join('');
    const title = probs.length ? `${nR ? nR + (nR > 1 ? ' pannes' : ' panne') : ''}${nR && nO ? ' + ' : ''}${nO ? nO + ' à renforcer' : ''}` : (r.err ? 'Je n\'ai pas pu lire ce site' : 'Rien à signaler');
    const statusSel = opts.live ? '' : `<select class="inp sm" data-act="status" data-host="${esc(r.host)}" aria-label="Statut">${S.statuses.map(s => `<option value="${s}" ${(p.status || 'a_contacter') === s ? 'selected' : ''}>${STATUS_LABEL[s] || s}</option>`).join('')}</select>`;
    const top = probs[0];
    return `<article class="card" data-host="${esc(r.host)}">
      <div class="card-h">
        <div class="score ${probs.length ? '' : 'ok'}">${probs.length || (r.err ? '?' : 'OK')}</div>
        <div><h3>${esc(r.name)}</h3><div class="sub"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.host)}</a> · ${esc(title)}</div></div>
        <div class="right">${pills}</div>
      </div>
      ${parcours(r)}
      ${inventory(r)}
      ${r.err && !probs.length ? `<div class="st-errcard"><div class="ic">🚧</div><div class="t">Je n'ai pas pu lire ce site.</div><div class="sub">${esc(String(r.err).split('\n')[0])}</div></div>` : ''}
      ${probs.map(c => lamp(c, true)).join('')}
      ${oks.length ? `<details class="more"><summary>Ce qui va bien ou n'a pas pu être vérifié (${oks.length})</summary>${oks.map(c => lamp(c, false)).join('')}</details>` : ''}
      ${payloadsBlock(r)}
      ${top && top.hook ? `<div class="hook">${esc(top.hook)}</div>` : ''}
      <div class="actions">
        ${top && top.hook ? `<button class="btn btn-xs" data-act="hook" data-host="${esc(r.host)}">Copier l'accroche</button><button class="btn btn-ghost btn-xs" data-act="email" data-host="${esc(r.host)}">Copier l'email E1</button>` : ''}
        ${reportUrl(r) ? `<button class="btn btn-ghost btn-xs" data-act="report" data-host="${esc(r.host)}">Copier le lien du rapport</button><a class="btn btn-ghost btn-xs" href="${esc(reportUrl(r))}" target="_blank" rel="noopener">Voir le rapport ↗</a>` : ''}
        ${opts.live ? `<button class="btn btn-ghost btn-xs" data-act="add" data-host="${esc(r.host)}">Ajouter aux marques</button>` : statusSel}
        ${r.scannedAt ? `<span class="fine">scanné le ${new Date(r.scannedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>` : ''}
      </div>
      ${opts.live ? '' : `<textarea class="inp note" data-act="note" data-host="${esc(r.host)}" placeholder="Note : décideur, email, relance…" rows="1">${esc(p.note || '')}</textarea>`}
    </article>`;
  }

  function renderKpis(f) {
    const q = S.qualified;
    const contacted = q.filter(r => S.pipeline[r.host]?.status && S.pipeline[r.host].status !== 'a_contacter').length;
    const crit = q.filter(r => controlsOf(r).some(c => c.color === 'rouge' && c.sev >= 5)).length;
    const items = [[S.full.length, 'sites scannés', ''], [q.length, 'avec une panne', ''], [crit, 'pannes critiques', 'red'], [f.appeared.length, 'nouveaux vs veille', ''], [f.fixed.length, 'sortis vs veille', 'green'], [contacted, 'dans le pipe', '']];
    $('#kpis').innerHTML = items.map(([v, l, c]) => `<div class="stat ${c}"><b>${v}</b><span>${l}</span></div>`).join('') + (f.last ? `<div class="stat white"><b>${fmtDate(f.last.date)}</b><span>dernier scan</span></div>` : '');
  }

  function filtered(f) {
    const q = $('#q').value.trim().toLowerCase(), code = $('#fCode').value, st = $('#fStatus').value, onlyNew = $('#fNew').checked;
    return S.qualified.filter(r =>
      (!q || (r.name + ' ' + r.host).toLowerCase().includes(q)) &&
      (!code || controlsOf(r).some(c => c.code === code && c.sev)) &&
      (!st || (S.pipeline[r.host]?.status || 'a_contacter') === st) &&
      (!onlyNew || f.isNew(r.host)));
  }

  function renderProspects() {
    const f = historyFacts();
    renderKpis(f);
    const rows = filtered(f);
    $('#list').innerHTML = rows.length ? rows.map(r => card(r, { facts: f })).join('') : '<div class="empty">Aucun prospect ne correspond aux filtres.</div>';
  }

  function renderFilters() {
    const codes = [...new Set(S.qualified.flatMap(r => controlsOf(r).filter(c => c.sev).map(c => c.code)))];
    $('#fCode').innerHTML = '<option value="">Toutes les pannes</option>' + codes.map(c => `<option value="${c}">${esc(CODE_LABEL[c] || c)}</option>`).join('');
    $('#fStatus').innerHTML = '<option value="">Tous les statuts</option>' + S.statuses.map(s => `<option value="${s}">${STATUS_LABEL[s] || s}</option>`).join('');
  }

  // ---------- charts (SVG) ----------
  function renderTrend() {
    const days = (S.index.days || []).slice(-60);
    const el = $('#chartTrend');
    if (days.length < 2) { el.innerHTML = '<p class="fine">Pas encore assez d\'historique.</p>'; return; }
    const W = Math.max(320, el.clientWidth - 40 || 800), H = 230, P = { l: 30, r: 10, t: 10, b: 26 };
    const max = Math.max(...days.map(d => d.qualified), 1);
    const x = i => P.l + i * (W - P.l - P.r) / (days.length - 1);
    const y = v => H - P.b - v * (H - P.t - P.b) / max;
    const line = key => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
    const area = `${line('qualified')}L${x(days.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
    const step = Math.ceil(days.length / 6);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Prospects qualifiés par jour">
      <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F5C518" stop-opacity=".25"/><stop offset="1" stop-color="#F5C518" stop-opacity="0"/></linearGradient></defs>
      ${[0, Math.round(max / 2), max].map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.08)"/><text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
      ${days.map((d, i) => i % step === 0 || i === days.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === days.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${fmtDate(d.date)}</text>` : '').join('')}
      <path d="${area}" fill="url(#ga)"/>
      <path d="${line('qualified')}" fill="none" stroke="#F5C518" stroke-width="2" style="filter:drop-shadow(0 0 6px rgba(245,197,24,.5))"/>
      <path d="${line('sev5')}" fill="none" stroke="#ff5a5a" stroke-width="1.6" stroke-dasharray="4 3"/>
      ${days.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.qualified)}" r="7" fill="transparent"><title>${d.date} — ${d.qualified} avec panne, ${d.sev5} critiques</title></circle>`).join('')}
    </svg><div class="legend"><span><i style="background:#F5C518"></i>Avec panne</span><span><i style="background:#ff5a5a"></i>Critiques</span></div>`;
  }

  function renderCodes() {
    const counts = {};
    S.qualified.forEach(r => controlsOf(r).filter(c => c.sev).forEach(c => { counts[c.code] = (counts[c.code] || 0) + 1; }));
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map(r => r[1]));
    $('#chartCodes').innerHTML = rows.length ? `<div class="bars">${rows.map(([c, n]) => `<div class="bar"><span>${esc(CODE_LABEL[c] || c)}</span><div class="track"><div class="fill" style="width:${(n / max * 100).toFixed(0)}%"></div></div><b>${n}</b></div>`).join('')}</div>` : '<p class="fine">—</p>';
  }

  function renderMoves() {
    const f = historyFacts();
    const li = (arr, dot, label) => arr.map(b => `<div class="move"><span class="dot ${dot}"></span><div><b>${esc(b.name)}</b> <span class="pill ${dot === 'o' ? 'new' : 'green'}">${label}</span><span class="fine">${esc(b.codes.map(c => CODE_LABEL[c] || c).join(' · '))}</span></div></div>`).join('');
    $('#moves').innerHTML = li(f.appeared, 'o', 'Nouveau') + li(f.fixed, 'g', 'Sorti') || '<p class="fine">Aucun mouvement entre les deux derniers scans.</p>';
  }

  function renderCandidates() {
    const byHost = Object.fromEntries(S.full.map(r => [r.host, r]));
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } };
    $('#candTable tbody').innerHTML = S.candidates.map(c => {
      const r = byHost[host(c.url)];
      const n = r ? controlsOf(r).filter(x => x.sev).length : 0;
      const state = !r ? '<span class="pill">jamais scanné</span>' : r.err && !n ? '<span class="pill red">illisible</span>' : r.qualified ? `<span class="pill new">${n} panne${n > 1 ? 's' : ''}</span>` : '<span class="pill green">propre</span>';
      return `<tr><td><b>${esc(c.name)}</b><br><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(host(c.url))}</a></td><td>${state}</td><td class="hide-sm fine">${r ? esc(controlsOf(r).filter(x => x.sev).map(x => CODE_LABEL[x.code] || x.code).join(' · ')) : ''}</td>
        <td>${S.mode === 'server' ? `<button class="btn btn-ghost btn-xs" data-act="del" data-url="${esc(c.url)}">Retirer</button>` : ''}</td></tr>`;
    }).join('');
  }

  function renderLive() {
    $('#liveList').innerHTML = S.live.length ? S.live.slice(0, 20).map(r => card(r, { live: true })).join('') : '<p class="fine center">Aucun scan pour l\'instant.</p>';
  }

  function renderAll() { renderFilters(); renderProspects(); renderTrend(); renderCodes(); renderMoves(); renderCandidates(); renderLive(); }

  // ---------- pipeline ----------
  async function savePipeline(host, patch) {
    S.pipeline[host] = { ...(S.pipeline[host] || {}), ...patch, updatedAt: new Date().toISOString() };
    if (S.mode === 'server') { try { await call('PUT', '/api/pipeline', { host, ...patch }); } catch (e) { toast('Erreur : ' + e.message); } }
    else ls.set('st.pipeline', S.pipeline);
  }

  // ---------- events ----------
  const findRec = host => S.qualified.find(r => r.host === host) || S.live.find(r => r.host === host);
  document.addEventListener('click', async e => {
    const g = e.target.closest('[data-goto]'); if (g) { e.preventDefault(); showTab(g.dataset.goto); return; }
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'TEXTAREA') return;
    const act = b.dataset.act, r = findRec(b.dataset.host);
    const top = r && (r.top || controlsOf(r).find(c => c.sev));
    if (act === 'hook' && top) copy(top.hook);
    if (act === 'email' && r) copy(emailE1(r));
    if (act === 'report' && r) copy(reportUrl(r));
    if (act === 'add' && r) { try { const j = await call('POST', '/api/candidates', { name: r.name, url: r.url }); S.candidates = j.candidates; renderCandidates(); toast('Ajoutée aux marques ✓'); } catch (err) { toast(err.message); } }
    if (act === 'del') { if (!confirm('Retirer cette marque du scan quotidien ?')) return; try { const j = await call('DELETE', '/api/candidates?url=' + encodeURIComponent(b.dataset.url)); S.candidates = j.candidates; renderCandidates(); toast('Retirée'); } catch (err) { toast(err.message); } }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.act === 'status') { savePipeline(t.dataset.host, { status: t.value }); renderKpis(historyFacts()); toast('Statut : ' + (STATUS_LABEL[t.value] || t.value)); }
    if (t.dataset.act === 'note') { savePipeline(t.dataset.host, { note: t.value }); toast('Note enregistrée'); }
  });
  ['#q', '#fCode', '#fStatus', '#fNew'].forEach(s => $(s).addEventListener('input', renderProspects));

  function showTab(name) {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + name));
    ls.set('st.tab', name);
    if (name === 'tendances') renderTrend();
    window.scrollTo({ top: 0 });
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

  // ---------- détecteur (étapes réelles en direct, via Server-Sent Events) ----------
  $('#scanForm').addEventListener('submit', e => {
    e.preventDefault();
    if (S.mode !== 'server') return toast('Le détecteur demande `npm run app`');
    const raw = $('#scanUrl').value.trim(); if (!raw) return;
    const btn = $('#scanBtn'); btn.disabled = true; btn.textContent = 'Analyse…';
    $('#detLive').innerHTML = '<b></b>en cours';
    const label = esc(raw.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    const out = $('#scanResult');
    out.innerHTML = `<div class="console st-report" style="margin-top:16px"><div class="console-bar"><i></i><i></i><i></i><span class="u">analyse · ${label}</span><span class="live"><b></b>en cours</span></div><div class="console-body"><div class="st-log2" id="st-log"></div><div class="st-bar"><i id="st-p"></i></div></div></div>`;
    setTimeout(() => { const i = $('#st-p'); if (i) { i.style.transition = 'width 150s cubic-bezier(.1,.6,.3,1)'; i.style.width = '94%'; } }, 60);
    const log = $('#st-log');
    const pushStep = msg => { log.querySelectorAll('.ln .sp').forEach(s => { s.outerHTML = '<span class="tk">✓</span>'; }); const d = document.createElement('div'); d.className = 'ln'; d.innerHTML = '<span class="sp"></span>' + esc(msg); log.appendChild(d); };
    const done = () => { btn.disabled = false; btn.textContent = 'Tester la boutique'; $('#detLive').innerHTML = '<b></b>prêt'; };
    const es = new EventSource('/api/scan/stream?url=' + encodeURIComponent(raw));
    es.addEventListener('step', ev => pushStep(JSON.parse(ev.data).msg));
    es.addEventListener('result', ev => {
      es.close(); done();
      const r = JSON.parse(ev.data);
      S.live.unshift(r);
      out.innerHTML = `<div class="st-report" style="margin-top:18px">${card(r, { live: true })}</div>`;
      renderLive();
    });
    es.addEventListener('fail', ev => {
      es.close(); done();
      let msg = 'Erreur'; try { msg = JSON.parse(ev.data).error; } catch (_) {}
      out.innerHTML = `<div class="console st-report" style="margin-top:16px"><div class="console-body"><div class="st-errcard"><div class="ic">🚧</div><div class="t">${esc(msg)}</div><div class="sub">Certaines boutiques bloquent les robots. Dans ce cas, le détecteur le dit et n'affirme rien.</div></div></div></div>`;
    });
    es.onerror = () => { if (es.readyState === 2) return; es.close(); done(); if (!out.querySelector('.card')) out.innerHTML = '<div class="console" style="margin-top:16px"><div class="console-body"><div class="st-errcard"><div class="ic">⏳</div><div class="t">Le détecteur est occupé</div><div class="sub">Réessayez dans une minute : il ne traite qu\'un test à la fois.</div></div></div></div>'; };
  });

  $('#addForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (S.mode !== 'server') return toast('Ajout possible uniquement avec `npm run app`');
    try { const j = await call('POST', '/api/candidates', { name: $('#addName').value, url: $('#addUrl').value }); S.candidates = j.candidates; e.target.reset(); renderCandidates(); toast('Ajoutée ✓'); }
    catch (err) { toast(err.message); }
  });

  $('#exportCsv').addEventListener('click', () => {
    const f = historyFacts();
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['marque', 'site', 'pannes', 'codes', 'preuve_principale', 'accroche', 'statut', 'note', 'nouveau']].concat(filtered(f).map(r => {
      const c = controlsOf(r).filter(x => x.sev);
      return [r.name, r.url, c.length, c.map(x => x.code).join(' | '), c[0]?.preuve, c[0]?.hook, STATUS_LABEL[S.pipeline[r.host]?.status || 'a_contacter'], S.pipeline[r.host]?.note, f.isNew(r.host) ? 'oui' : ''];
    }));
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  });

  window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(renderTrend, 150); });

  // ---------- boot ----------
  (async () => {
    try {
      const d = await getJSON('/api/data');
      Object.assign(S, d);
      try { S.live = await getJSON('/api/live-scans'); } catch (_) {}
      $('#mode').className = 'mode live'; $('#mode').innerHTML = '<b></b><span>détecteur actif</span>';
    } catch (_) {
      S.mode = 'static';
      const [q, full, idx, cand] = await Promise.all(['../qualified.json', '../latest-full.json', '../history/index.json', '../candidates.json'].map(u => getJSON(u).catch(() => null)));
      S.qualified = q || []; S.full = full || []; S.index = idx || { days: [] }; S.candidates = cand || [];
      S.pipeline = ls.get('st.pipeline', {});
      $('#mode').innerHTML = '<b></b><span>mode lecture</span>';
      $('#scanBtn').disabled = true; $('#scanHint').textContent = 'Détecteur indisponible en mode lecture : lance `npm run app` en local.';
    }
    renderAll();
    const tab = ls.get('st.tab', null);
    if (tab && document.getElementById('tab-' + tab)) showTab(tab);
  })();
})();
