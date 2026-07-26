// Skill Tracking — autonomous tracking-defect scanner.
// Runs on GitHub Actions (open web egress, no dependency on anyone's local browser).
// For each candidate: loads the homepage in a FRESH context (no consent given),
// records the real network requests + runtime dataLayer, and flags ONLY defects
// that are actually observed. Never infers a defect that isn't in the evidence.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const U = a => [...new Set(a)];
const CMP_SET = ['Axeptio', 'Didomi', 'Cookiebot', 'OneTrust', 'ConsentManager', 'tarteaucitron'];

function scoreDefects(r) {
  // returns { defects:[{code,sev,evidence,hook}], runsAds, qualified, top }
  const defects = [];
  const runsAds = r.awGads || (r.fbFire && r.fbFire.length > 0) || r.tt || r.pin || r.snap || r.crit;
  const hasCMP = CMP_SET.includes(r.cmp);
  const V2 = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];

  // 1. Double GA4 — airtight (two properties receiving hits)
  if (r.ga4Fire && r.ga4Fire.length >= 2)
    defects.push({ code: 'DOUBLE_GA4', sev: 5, evidence: `${r.ga4Fire.length} propriétés GA4 reçoivent des hits: ${r.ga4Fire.join(', ')}`, hook: `Deux GA4 tournent en parallèle (${r.ga4Fire.join(' + ')}) : chaque événement est compté deux fois, vos taux de conversion et votre ROAS sont faux dans les deux propriétés.` });

  // 2. Meta pixel fired pre-consent — airtight (fresh load, no consent given)
  if (r.fbFire && r.fbFire.length >= 1)
    defects.push({ code: 'META_PRECONSENT', sev: 5, evidence: `facebook.com/tr a émis dès le chargement (sans consentement), pixel(s): ${r.fbFire.join(', ')}`, hook: `Votre pixel Meta (${r.fbFire[0]}) se déclenche AVANT le moindre consentement — au chargement de la page, requête à facebook.com/tr partie. C'est à la fois un risque CNIL et un signal que Meta va finir par filtrer.` });

  // 2b. Double Meta pixel
  if (r.fbFire && r.fbFire.length >= 2)
    defects.push({ code: 'DOUBLE_META', sev: 4, evidence: `${r.fbFire.length} pixels Meta: ${r.fbFire.join(', ')}`, hook: `Deux pixels Meta tirent sur la même page (${r.fbFire.join(' + ')}) : déduplication cassée, événements comptés en double, budget optimisé sur des chiffres gonflés.` });

  // 3. GA4 granted-by-default before consent — strong
  if (r.gcs && r.gcs.includes('G111'))
    defects.push({ code: 'CONSENT_GRANTED_DEFAULT', sev: 4, evidence: `GA4 /collect envoyé avec gcs=G111 (granted) sur un chargement sans consentement`, hook: `Votre Consent Mode démarre en "granted" par défaut : GA4 collecte avant que l'utilisateur ait accepté. Non conforme, et Google le sait — le Consent Mode v2 mal réglé dégrade la modélisation des conversions.` });

  // 4. CMP present but Consent Mode not wired (no gcs signal at all) — strong
  if (hasCMP && r.ga4Fire && r.ga4Fire.length >= 1 && (!r.gcs || r.gcs.length === 0) && r.consent !== 'default')
    defects.push({ code: 'CONSENT_MODE_MISSING', sev: 4, evidence: `CMP=${r.cmp} présent mais aucun signal gcs / gtag consent default détecté alors que GA4 tire`, hook: `Vous avez un bandeau ${r.cmp}, mais il n'est pas branché au Consent Mode de Google : aucun signal de consentement n'accompagne vos hits. Résultat : ni conformité propre, ni récupération des conversions consenties par modélisation.` });

  // 5. Consent Mode v2 default incomplete (missing one of the 4 required signals)
  if (r.consent === 'default' && Array.isArray(r.cf)) {
    const missing = V2.filter(k => !r.cf.includes(k));
    if (missing.length && missing.length < 4)
      defects.push({ code: 'CONSENT_V2_INCOMPLETE', sev: 3, evidence: `consent default présent mais champs manquants: ${missing.join(', ')}`, hook: `Votre Consent Mode v2 est incomplet — il manque ${missing.join(' et ')} dans la config par défaut. Sur Google Ads, ça bloque la modélisation des conversions post-consentement (vous laissez des conversions sur la table).` });
  }

  // 6. Legacy Universal Analytics still firing (dead since juil. 2023)
  if (r.uaFire && r.uaFire.length >= 1)
    defects.push({ code: 'LEGACY_UA', sev: 3, evidence: `Universal Analytics tire encore: ${r.uaFire.join(', ')}`, hook: `Universal Analytics (${r.uaFire[0]}) tire encore sur votre site alors que Google l'a coupé en 2023 : du code mort qui alourdit vos pages et trahit un tracking jamais revu.` });

  // 7. All client-side, no server-side collection while spending on ads — core Skill Tracking angle
  const serverSide = (r.serverGtmHost && r.serverGtmHost.length) || (r.firstPartyCollect && r.firstPartyCollect.length) || r.stape;
  if (runsAds && !serverSide)
    defects.push({ code: 'NO_SERVER_SIDE', sev: 3, evidence: `Aucun endpoint server-side / first-party détecté (GTM chargé depuis googletagmanager.com), alors que des pixels publicitaires tirent`, hook: `Tout votre tracking part côté navigateur — aucune collecte server-side détectée. Entre ITP/Safari, les adblockers et le consentement, une part croissante de vos conversions Meta & Google n'arrive jamais : vos algos optimisent sur une donnée tronquée.` });

  defects.sort((a, b) => b.sev - a.sev);
  const qualified = defects.length > 0 && (runsAds || defects.some(d => d.sev >= 4));
  return { defects, runsAds, qualified, top: defects[0] || null };
}

async function run() {
  const candidates = JSON.parse(fs.readFileSync(process.argv[2] || 'candidates.json', 'utf8'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
  const out = [];
  for (const c of candidates) {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'fr-FR', viewport: { width: 1366, height: 900 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    const reqs = [];
    page.on('request', q => reqs.push(q.url()));
    let err = null;
    try {
      await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(4500);
    } catch (e) { err = String(e.message || e).slice(0, 140); }

    const grab = re => U(reqs.map(u => { const x = u.match(re); return x ? x[1] : null; }).filter(Boolean));
    const ga4Fire = grab(/[?&]tid=(G-[A-Z0-9]{7,12})/i);
    const uaFire = grab(/[?&]tid=(UA-\d+-\d+)/i);
    const gaReqs = reqs.filter(u => /google-analytics\.com\/g\/collect|\/g\/collect\?/.test(u));
    const gcs = U(gaReqs.map(u => { const x = u.match(/[?&]gcs=([^&]+)/); return x ? x[1] : null; }).filter(Boolean));
    const awGads = reqs.some(u => /googleads\.g\.doubleclick\.net|googleadservices\.com\/pagead\/conversion|google\.com\/pagead|\/pagead\/1p-conversion/.test(u));
    const fbFire = U(reqs.filter(u => /facebook\.com\/tr/.test(u)).map(u => { const x = u.match(/[?&]id=(\d{6,})/); return x ? x[1] : null; }).filter(Boolean));
    const tt = reqs.some(u => /analytics\.tiktok\.com/.test(u));
    const pin = reqs.some(u => /ct\.pinterest\.com|pinterest\.com\/ct/.test(u));
    const snap = reqs.some(u => /tr\.snapchat\.com|sc-static\.net/.test(u));
    const crit = reqs.some(u => /criteo\.(com|net)/.test(u));
    const gtmIds = grab(/[?&]id=(GTM-[A-Z0-9]{5,9})/);
    const gtmReqs = reqs.filter(u => /gtm\.js\?id=|gtag\/js\?id=/.test(u));
    const gtmHosts = U(gtmReqs.map(u => { try { return new URL(u).hostname; } catch (_) { return null; } }).filter(Boolean));
    const serverGtmHost = gtmHosts.filter(h => !/googletagmanager\.com/.test(h));
    const host = (() => { try { return new URL(c.url).hostname.replace(/^www\./, ''); } catch (_) { return c.url; } })();
    const rootDomain = host.split('.').slice(-2).join('.');
    const firstPartyCollect = U(reqs.filter(u => { try { const H = new URL(u).hostname; return H.includes(rootDomain) && /\/g\/collect|\/collect\?|\/gtm\.js|\/tr\b|\/mp\/collect|\/j\/collect/.test(u) && !/googletagmanager|google-analytics|facebook|doubleclick/.test(H); } catch (_) { return false; } }).map(u => { try { return new URL(u).hostname; } catch (_) { return null; } }).filter(Boolean));
    const stape = reqs.some(u => /stape\.io/.test(u));

    let pd = {};
    try {
      pd = await page.evaluate(() => {
        const dl = window.dataLayer || [];
        let consent = 'none', cf = [];
        try { for (const e of dl) { if (e && (e[0] === 'consent') && (e[1] === 'default')) { consent = 'default'; cf = Object.keys(e[2] || {}); } } } catch (_) {}
        let fbIds = [];
        try { if (window.fbq && fbq.instance && fbq.instance.pixelsByID) fbIds = Object.keys(fbq.instance.pixelsByID); } catch (_) {}
        const h = document.documentElement.innerHTML;
        const cmp = /axeptio/i.test(h) ? 'Axeptio' : /didomi/i.test(h) ? 'Didomi' : /cookiebot/i.test(h) ? 'Cookiebot' : /onetrust|otSDK/i.test(h) ? 'OneTrust' : /consentmanager/i.test(h) ? 'ConsentManager' : /tarteaucitron/i.test(h) ? 'tarteaucitron' : (window.Shopify ? 'ShopifyNative?' : '?');
        return { consent, cf, fbIds, cmp, shopify: !!window.Shopify, title: (document.title || '').slice(0, 90) };
      });
    } catch (e) { pd = { evalErr: String(e.message || e).slice(0, 80) }; }

    const rec = {
      name: c.name, host, url: c.url, err,
      ga4Fire, uaFire, gcs, awGads, fbFire: U([...(fbFire), ...((pd.fbIds) || [])]),
      tt, pin, snap, crit, gtmIds, serverGtmHost, firstPartyCollect, stape,
      consent: pd.consent, cf: pd.cf, cmp: pd.cmp, shopify: pd.shopify, title: pd.title, nReq: reqs.length
    };
    const s = scoreDefects(rec);
    rec.runsAds = s.runsAds; rec.qualified = s.qualified; rec.defects = s.defects; rec.top = s.top;
    out.push(rec);
    console.log(`${s.qualified ? '✓' : '·'} ${c.name} — ${s.defects.map(d => d.code).join(',') || (err ? 'ERR ' + err.slice(0, 40) : 'clean')}`);
    await ctx.close();
  }
  await browser.close();

  const qualified = out.filter(r => r.qualified).sort((a, b) => (b.top ? b.top.sev : 0) - (a.top ? a.top.sev : 0));
  fs.writeFileSync('latest-full.json', JSON.stringify(out, null, 1));
  fs.writeFileSync('qualified.json', JSON.stringify(qualified, null, 1));
  try { fs.mkdirSync('history', { recursive: true }); } catch (_) {}
  const stamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join('history', stamp + '.json'), JSON.stringify(qualified, null, 1));
  console.log(`\nScanned ${out.length} · qualified ${qualified.length} · errors ${out.filter(r => r.err).length}`);
}

module.exports = { scoreDefects };
if (require.main === module) run().catch(e => { console.error('FATAL', e); process.exit(1); });
