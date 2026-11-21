// Skill Tracking — Radar (front). Works in two modes:
//  - server : `npm run app` → live detector + pipeline saved in pipeline.json
//  - static : opened from GitHub Pages / any static host → read-only data, pipeline in localStorage
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CODE_LABEL = {
    DOUBLE_GA4: 'Double GA4', META_PRECONSENT: 'Meta avant consentement', DOUBLE_META: 'Double pixel Meta',
    CONSENT_GRANTED_DEFAULT: 'Consent "granted" par défaut', CONSENT_MODE_MISSING: 'Consent Mode non branché',
    CONSENT_V2_INCOMPLETE: 'Consent Mode v2 incomplet', LEGACY_UA: 'Universal Analytics', NO_SERVER_SIDE: 'Pas de server-side'
  };
  const STATUS_LABEL = { a_contacter: 'À contacter', contacte: 'Contacté', relance: 'Relancé', repondu: 'A répondu', rdv: 'RDV', signe: 'Signé', perdu: 'Perdu' };

  const S = { mode: 'static', qualified: [], full: [], index: { days: [] }, candidates: [], pipeline: {}, statuses: Object.keys(STATUS_LABEL), live: [] };

  // ---------- helpers ----------
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }
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

  // ---------- history-derived facts ----------
  function historyFacts() {
    const days = S.index.days || [];
    const last = days[days.length - 1], prev = days[days.length - 2];
    const prevHosts = new Set((prev?.brands || []).map(b => b.host));
    const curHosts = new Set((last?.brands || []).map(b => b.host));
    const streak = {};
    for (const h of curHosts) {
      let n = 0;
      for (let i = days.length - 1; i >= 0; i--) { if (days[i].brands.some(b => b.host === h)) n++; else break; }
      streak[h] = n;
    }
    const isNew = h => prev ? !prevHosts.has(h) : false;
    const fixed = prev ? prev.brands.filter(b => !curHosts.has(b.host)) : [];
    const appeared = last ? last.brands.filter(b => isNew(b.host)) : [];
    return { last, prev, streak, isNew, fixed, appeared };
  }

  // ---------- outbound copy ----------
  function emailE1(r) {
    const top = r.top || r.defects[0];
    const others = r.defects.filter(d => d !== top && d.code !== top.code).slice(0, 2);
    const extra = others.length ? `\n\nEt ce n'est pas le seul point : ${others.map(d => (CODE_LABEL[d.code] || d.code).toLowerCase()).join(', ')}.` : '';
    return `Objet : ${r.name} — un souci de tracking repéré sur votre site\n\nBonjour,\n\nEn auditant le tracking de marques DTC françaises, je suis passé sur ${r.host}.\n\n${top.hook}${extra}\n\nJ'ai la capture réseau qui le montre (requêtes observées au chargement, sans aucun clic sur le bandeau). Je vous l'envoie ? 15 min suffisent pour vous montrer l'impact et la correction.\n\nBonne journée,\nNicolas — Skill Tracking`;
  }

  // ---------- rendering ----------
  function stackChips(r) {
    const on = (b, label, cls = 'on') => b ? `<span class="chip ${cls}">${label}</span>` : '';
    const ss = (r.serverGtmHost?.length || r.firstPartyCollect?.length || r.stape);
    return `<div class="chips">
      ${(r.ga4Fire || []).map(id => `<span class="chip on" title="GA4">${esc(id)}</span>`).join('')}
      ${(r.uaFire || []).map(id => `<span class="chip bad" title="Universal Analytics">${esc(id)}</span>`).join('')}
      ${(r.gtmIds || []).map(id => `<span class="chip on" title="Google Tag Manager">${esc(id)}</span>`).join('')}
      ${r.fbFire?.length ? `<span class="chip on">Meta ×${r.fbFire.length}</span>` : ''}
      ${on(r.awGads, 'Google Ads')}${on(r.tt, 'TikTok')}${on(r.pin, 'Pinterest')}${on(r.snap, 'Snap')}${on(r.crit, 'Criteo')}
      ${r.cmp && r.cmp !== '?' ? `<span class="chip on" title="CMP">CMP : ${esc(r.cmp)}</span>` : '<span class="chip">CMP : ?</span>'}
      ${on(r.shopify, 'Shopify')}
      ${ss ? '<span class="chip good">Server-side ✓</span>' : (r.runsAds ? '<span class="chip bad">100 % client-side</span>' : '')}
      ${r.gcs?.length ? `<span class="chip on" title="Consent signal GA4">gcs=${esc(r.gcs.join(','))}</span>` : ''}
    </div>`;
  }

  function card(r, opts = {}) {
    const f = opts.facts;
    const sev = r.top ? r.top.sev : 0;
    const p = S.pipeline[r.host] || {};
    const badges = [
      f && f.isNew(r.host) ? '<span class="badge new">NOUVEAU</span>' : '',
      f && f.streak[r.host] > 1 ? `<span class="badge" title="jours consécutifs avec défaut">en défaut depuis ${f.streak[r.host]} j</span>` : '',
      r.err ? `<span class="badge err" title="${esc(r.err)}">erreur de chargement</span>` : '',
      opts.live && !r.defects.length && !r.err ? '<span class="badge fixed">propre</span>' : ''
    ].join('');
    const defects = r.defects.length ? `<ul class="defects">${r.defects.map(d => `<li><span class="sev s${d.sev}">S${d.sev}</span><div><span class="code">${esc(CODE_LABEL[d.code] || d.code)}</span> <span class="ev">— ${esc(d.evidence)}</span></div></li>`).join('')}</ul>` : r.err ? `<p class="small">⚠️ Site non chargé — impossible de conclure. <span class="muted">${esc(r.err.split('\n')[0])}</span></p>` : '<p class="muted small">Aucun défaut observé.</p>';
    const statusSel = opts.live ? '' : `<select data-act="status" data-host="${esc(r.host)}">${S.statuses.map(s => `<option value="${s}" ${(p.status || 'a_contacter') === s ? 'selected' : ''}>${STATUS_LABEL[s] || s}</option>`).join('')}</select>`;
    return `<article class="card s${sev}" data-host="${esc(r.host)}">
      <div class="card-h">
        <h4>${esc(r.name)}</h4><a href="${esc(r.url)}" target="_blank" rel="noopener" class="small">${esc(r.host)}</a>${badges}
        <div class="right">${sev ? `<span class="sev s${sev}">S${sev}</span>` : ''}<span class="muted small">${r.runsAds ? 'fait de la pub' : 'pas de pub vue'}</span></div>
      </div>
      ${stackChips(r)}
      ${defects}
      ${r.top ? `<div class="hook">${esc(r.top.hook)}</div>` : ''}
      <div class="actions">
        ${r.top ? `<button class="mini" data-act="hook" data-host="${esc(r.host)}">Copier l'accroche</button><button class="mini ghost" data-act="email" data-host="${esc(r.host)}">Copier l'email E1</button>` : ''}
        ${opts.live ? `<button class="mini ghost" data-act="add" data-host="${esc(r.host)}">Ajouter aux marques</button>` : statusSel}
        ${opts.live && r.scannedAt ? `<span class="muted small">scanné le ${new Date(r.scannedAt).toLocaleString('fr-FR')}</span>` : ''}
      </div>
      ${opts.live ? '' : `<textarea class="note" data-act="note" data-host="${esc(r.host)}" placeholder="Note (décideur, email, relance…)">${esc(p.note || '')}</textarea>`}
    </article>`;
  }

  function renderKpis(f) {
    const q = S.qualified;
    const contacted = q.filter(r => S.pipeline[r.host]?.status && S.pipeline[r.host].status !== 'a_contacter').length;
    const items = [
      [S.full.length, 'sites scannés'],
      [q.length, 'prospects qualifiés'],
      [q.filter(r => r.top?.sev >= 5).length, 'défauts critiques (S5)'],
      [f.appeared.length, 'nouveaux vs veille'],
      [f.fixed.length, 'sortis vs veille'],
      [contacted, 'déjà dans le pipe']
    ];
    $('#kpis').innerHTML = items.map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('') +
      (f.last ? `<div class="kpi"><b>${fmtDate(f.last.date)}</b><span>dernier scan</span></div>` : '');
  }

  function filtered(f) {
    const q = $('#q').value.trim().toLowerCase(), code = $('#fCode').value, st = $('#fStatus').value, onlyNew = $('#fNew').checked;
    return S.qualified.filter(r =>
      (!q || (r.name + ' ' + r.host).toLowerCase().includes(q)) &&
      (!code || r.defects.some(d => d.code === code)) &&
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
    const codes = [...new Set(S.qualified.flatMap(r => r.defects.map(d => d.code)))];
    $('#fCode').innerHTML = '<option value="">Tous les défauts</option>' + codes.map(c => `<option value="${c}">${CODE_LABEL[c] || c}</option>`).join('');
    $('#fStatus').innerHTML = '<option value="">Tous les statuts</option>' + S.statuses.map(s => `<option value="${s}">${STATUS_LABEL[s] || s}</option>`).join('');
  }

  // ---------- charts (inline SVG, no lib) ----------
  function renderTrend() {
    const days = (S.index.days || []).slice(-60);
    const el = $('#chartTrend');
    if (days.length < 2) { el.innerHTML = '<p class="muted">Pas encore assez d\'historique.</p>'; return; }
    const W = Math.max(320, el.clientWidth || 800), H = 220, P = { l: 30, r: 10, t: 10, b: 24 };
    const max = Math.max(...days.map(d => d.qualified), 1);
    const x = i => P.l + i * (W - P.l - P.r) / (days.length - 1);
    const y = v => H - P.b - v * (H - P.t - P.b) / max;
    const line = key => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
    const ticks = [0, Math.round(max / 2), max];
    const step = Math.ceil(days.length / 6);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Prospects qualifiés par jour">
      ${ticks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
      ${days.map((d, i) => i % step === 0 || i === days.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === days.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${fmtDate(d.date)}</text>` : '').join('')}
      <path d="${line('qualified')}" fill="none" stroke="var(--info)" stroke-width="2"/>
      <path d="${line('sev5')}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      ${days.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.qualified)}" r="6" fill="transparent"><title>${d.date} — ${d.qualified} qualifiés, ${d.sev5} S5</title></circle>`).join('')}
    </svg><div class="legend"><span><i style="background:var(--info)"></i>Qualifiés</span><span><i style="background:var(--accent)"></i>Critiques (S5)</span></div>`;
  }

  function renderCodes() {
    const counts = {};
    S.qualified.forEach(r => r.defects.forEach(d => { counts[d.code] = (counts[d.code] || 0) + 1; }));
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map(r => r[1]));
    $('#chartCodes').innerHTML = rows.length ? `<div class="bars">${rows.map(([c, n]) => `<div class="bar"><span>${CODE_LABEL[c] || c}</span><div class="track"><div class="fill" style="width:${(n / max * 100).toFixed(0)}%"></div></div><b>${n}</b></div>`).join('')}</div>` : '<p class="muted">—</p>';
  }

  function renderMoves() {
    const f = historyFacts();
    const li = (arr, cls, label) => arr.length ? arr.map(b => `<div><span class="badge ${cls}">${label}</span> ${esc(b.name)} <span class="muted small">${esc(b.codes.map(c => CODE_LABEL[c] || c).join(', '))}</span></div>`).join('') : '';
    const html = li(f.appeared, 'new', 'NOUVEAU') + li(f.fixed, 'fixed', 'SORTI');
    $('#moves').innerHTML = html || '<p class="muted">Aucun mouvement entre les deux derniers scans.</p>';
  }

  function renderCandidates() {
    const byHost = Object.fromEntries(S.full.map(r => [r.host, r]));
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } };
    $('#candTable tbody').innerHTML = S.candidates.map(c => {
      const r = byHost[host(c.url)];
      const state = !r ? '<span class="badge">jamais scanné</span>' : r.err ? '<span class="badge err">erreur</span>' : r.qualified ? `<span class="sev s${r.top.sev}">qualifié S${r.top.sev}</span>` : '<span class="badge fixed">propre</span>';
      return `<tr><td><b>${esc(c.name)}</b><br><a class="small" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(host(c.url))}</a></td><td>${state}</td><td class="small muted">${r ? esc(r.defects.map(d => d.code).join(', ')) : ''}</td>
        <td>${S.mode === 'server' ? `<button class="mini ghost" data-act="del" data-url="${esc(c.url)}">Retirer</button>` : ''}</td></tr>`;
    }).join('');
  }

  function renderLive() {
    $('#liveList').innerHTML = S.live.length ? S.live.slice(0, 20).map(r => card(r, { live: true })).join('') : '<p class="muted small">Aucun scan live pour l\'instant.</p>';
  }

  function renderAll() { renderFilters(); renderProspects(); renderTrend(); renderCodes(); renderMoves(); renderCandidates(); renderLive(); }

  // ---------- pipeline persistence ----------
  async function savePipeline(host, patch) {
    S.pipeline[host] = { ...(S.pipeline[host] || {}), ...patch, updatedAt: new Date().toISOString() };
    if (S.mode === 'server') { try { await call('PUT', '/api/pipeline', { host, ...patch }); } catch (e) { toast('Erreur : ' + e.message); } }
    else ls.set('st.pipeline', S.pipeline);
  }

  // ---------- events ----------
  const findRec = host => S.qualified.find(r => r.host === host) || S.live.find(r => r.host === host);
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'TEXTAREA') return;
    const act = b.dataset.act, r = findRec(b.dataset.host);
    if (act === 'hook' && r) copy(r.top.hook);
    if (act === 'email' && r) copy(emailE1(r));
    if (act === 'add' && r) { try { const j = await call('POST', '/api/candidates', { name: r.name, url: r.url }); S.candidates = j.candidates; renderCandidates(); toast('Ajouté aux marques ✓'); } catch (err) { toast(err.message); } }
    if (act === 'del') { if (!confirm('Retirer cette marque du scan quotidien ?')) return; try { const j = await call('DELETE', '/api/candidates?url=' + encodeURIComponent(b.dataset.url)); S.candidates = j.candidates; renderCandidates(); toast('Retirée'); } catch (err) { toast(err.message); } }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.act === 'status') { savePipeline(t.dataset.host, { status: t.value }); renderKpis(historyFacts()); toast('Statut : ' + (STATUS_LABEL[t.value] || t.value)); }
    if (t.dataset.act === 'note') { savePipeline(t.dataset.host, { note: t.value }); toast('Note enregistrée'); }
  });
  ['#q', '#fCode', '#fStatus', '#fNew'].forEach(s => $(s).addEventListener('input', renderProspects));

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab));
    ls.set('st.tab', b.dataset.tab);
    if (b.dataset.tab === 'tendances') renderTrend();
  });

  $('#scanForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (S.mode !== 'server') return toast('Le détecteur live demande `npm run app`');
    const btn = $('#scanBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Scan…';
    $('#scanResult').innerHTML = '';
    try {
      const r = await call('POST', '/api/scan', { url: $('#scanUrl').value, name: $('#scanName').value });
      S.live.unshift(r);
      $('#scanResult').innerHTML = card(r, { live: true });
      renderLive();
    } catch (err) { $('#scanResult').innerHTML = `<div class="panel">❌ ${esc(err.message)}</div>`; }
    finally { btn.disabled = false; btn.textContent = 'Scanner'; }
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
    const rows = [['marque', 'site', 'severite', 'defauts', 'accroche', 'statut', 'note', 'nouveau']].concat(filtered(f).map(r => [
      r.name, r.url, r.top?.sev, r.defects.map(d => d.code).join(' | '), r.top?.hook, STATUS_LABEL[S.pipeline[r.host]?.status || 'a_contacter'], S.pipeline[r.host]?.note, f.isNew(r.host) ? 'oui' : ''
    ]));
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
      $('#mode').textContent = '● mode serveur — détecteur actif';
    } catch (_) {
      S.mode = 'static';
      const [q, full, idx, cand] = await Promise.all(['../qualified.json', '../latest-full.json', '../history/index.json', '../candidates.json'].map(u => getJSON(u).catch(() => null)));
      S.qualified = q || []; S.full = full || []; S.index = idx || { days: [] }; S.candidates = cand || [];
      S.pipeline = ls.get('st.pipeline', {});
      $('#mode').textContent = 'mode lecture — lance `npm run app` pour le détecteur';
      $('#scanBtn').disabled = true; $('#scanHint').textContent = 'Détecteur live indisponible en mode lecture : lance `npm run app` en local.';
    }
    renderAll();
    const tab = ls.get('st.tab', null);
    if (tab) document.querySelector(`#tabs button[data-tab="${tab}"]`)?.click();
  })();
})();
