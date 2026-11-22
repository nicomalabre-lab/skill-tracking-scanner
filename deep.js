// Skill Tracking — moteur de scan PROFOND.
// Rejoue un vrai visiteur, en 3 sessions isolées (contextes neufs) :
//   A. Visiteur neuf, aucun clic        → ce qui part AVANT tout consentement
//   B. Clic « Refuser »                  → ce qui part MALGRÉ le refus (pire cas)
//   C. Clic « Accepter » + parcours      → la mesure fonctionne-t-elle ?
//        accueil → catégorie → fiche produit → ajout panier → panier → checkout
// Chaque requête est horodatée (preuve « 0,4 s après ouverture ») et les corps
// POST sont lus (GA4 et Meta envoient souvent leurs événements en POST groupé).
// Règle d'or : on ne signale QUE ce qui est observé. Ce qu'on n'a pas pu
// vérifier sort en gris, jamais en rouge.

const U = a => [...new Set(a)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------------------------------------------------------------- hit parsing
const AD_VENDORS = [
  ['TikTok', /analytics\.tiktok\.com\/api|analytics\.tiktok\.com\/i18n\/pixel\/events/],
  ['Pinterest', /ct\.pinterest\.com\/(v3|user)/],
  ['Snapchat', /tr\.snapchat\.com\/p|tr-shadow\.snapchat\.com/],
  ['Criteo', /(sslwidget|dis|gum|widget)\.criteo\.(com|net)\/(event|syncframe|js\/ld)/],
  ['Microsoft Ads', /bat\.bing\.com\/action/],
  ['LinkedIn', /px\.ads\.linkedin\.com\/(collect|attribution)/],
  ['X / Twitter', /analytics\.twitter\.com\/i\/adsct|t\.co\/i\/adsct/],
  ['Google Ads', /googleads\.g\.doubleclick\.net\/pagead\/(viewthroughconversion|conversion)|googleadservices\.com\/pagead\/conversion|google\.[a-z.]+\/pagead\/1p-(user-list|conversion)|\/pagead\/1p-conversion/],
  ['Floodlight', /fls\.doubleclick\.net\/activity/],
  ['Taboola', /trc\.taboola\.com\/.*\/log|cdn\.taboola\.com\/libtrc\/unip/],
  ['Outbrain', /tr\.outbrain\.com\/unifiedPixel/]
];
const ANALYTICS_VENDORS = [
  ['Hotjar', /(in|vc|content)\.hotjar\.(com|io)/],
  ['Microsoft Clarity', /[a-z]\.clarity\.ms\/collect/],
  ['Contentsquare', /c\.contentsquare\.net|t\.contentsquare\.net/],
  ['Matomo / Piwik', /matomo\.php|piwik\.php|\.piwik\.pro\/ppms\.php/],
  ['Kameleoon', /data\.kameleoon\.(io|eu)/],
  ['AB Tasty', /ariane\.abtasty\.com/]
];

function qs(str) {
  const o = {};
  if (!str) return o;
  for (const part of str.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    let k = (i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' ');
    try { k = decodeURIComponent(k); } catch (_) {}
    let v = i < 0 ? '' : part.slice(i + 1);
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (_) {}
    o[k] = v;
  }
  return o;
}

// One network request → 0..n normalized hits
function parseRequest(url, post) {
  const hits = [];
  let u; try { u = new URL(url); } catch (_) { return hits; }
  const host = u.hostname, path = u.pathname, q = qs(u.search.slice(1));

  // GA4 (google-analytics.com, region1.*, or first-party / server-side /g/collect)
  if (/\/g\/collect$/.test(path) || (/\/collect$/.test(path) && /^G-/.test(q.tid || ''))) {
    const lines = post && /(^|&)en=/.test(post) ? post.split(/\r?\n/).filter(Boolean) : [''];
    for (const line of lines) {
      const p = { ...q, ...qs(line) };
      if (!/^G-/.test(p.tid || '')) continue;
      hits.push({
        kind: 'ga4', id: p.tid, ev: p.en || 'page_view', gcs: p.gcs || null, host,
        firstParty: !/google-analytics\.com|analytics\.google\.com/.test(host),
        value: p['epn.value'] ?? p['ep.value'] ?? null, currency: p.cu || null, pid: p._p || null, seq: p._s || null, items: Object.keys(p).filter(k => /^pr\d+$/.test(k)).length
      });
    }
    return hits;
  }
  // Universal Analytics (dead since 2023)
  if (/google-analytics\.com\/(r\/)?collect|\/j\/collect/.test(host + path) && /^UA-/.test(q.tid || qs(post || '').tid || '')) {
    hits.push({ kind: 'ua', id: q.tid || qs(post).tid, ev: q.t || 'pageview', host }); return hits;
  }
  // Meta pixel (GET image, or POST form)
  if (/facebook\.com$/.test(host) && /^\/tr\/?$/.test(path)) {
    const p = { ...q, ...(post && !post.startsWith('{') ? qs(post) : {}) };
    if (p.id) hits.push({ kind: 'meta', id: p.id, ev: p.ev || 'PageView', eid: p.eid || null, value: p['cd[value]'] ?? null, currency: p['cd[currency]'] ?? null, host });
    return hits;
  }
  // Meta via server-side / first-party proxy (capig, stape…) — counts as server-side signal
  if (/\/(capig|meta|fb)\/?(events|tr)/i.test(path) && !/facebook\.com$/.test(host)) { hits.push({ kind: 'metaProxy', host }); return hits; }

  for (const [name, re] of AD_VENDORS) if (re.test(url)) {
    let ev = null;
    if (name === 'TikTok' && post && post.startsWith('{')) { try { ev = JSON.parse(post).event; } catch (_) {} }
    if (name === 'Google Ads' || name === 'Floodlight') hits.push({ kind: 'ads', vendor: name, ev, gcs: q.gcs || null, host });
    else hits.push({ kind: 'ads', vendor: name, ev, host });
    return hits;
  }
  for (const [name, re] of ANALYTICS_VENDORS) if (re.test(url)) { hits.push({ kind: 'analytics', vendor: name, host }); return hits; }

  // Tag loaders
  if (/\/gtm\.js$/.test(path) && /^GTM-/.test(q.id || '')) hits.push({ kind: 'gtm', id: q.id, host, firstParty: !/googletagmanager\.com$/.test(host) });
  else if (/\/gtag\/js$/.test(path) && q.id) hits.push({ kind: 'gtag', id: q.id, host, firstParty: !/googletagmanager\.com$/.test(host) });
  if (/stape\.(io|net)|\.stape\./.test(host)) hits.push({ kind: 'stape', host });
  return hits;
}

// ---------------------------------------------------------------- session
async function openSession(browser, label) {
  const ctx = await browser.newContext({ userAgent: UA, locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1366, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (_) {}
    // Journal de CHAQUE dataLayer.push (payload sérialisé), pour valider les objets envoyés.
    try {
      const log = []; window.__stDL = log; let dl;
      const ser = x => { try { return JSON.parse(JSON.stringify(x, (k, v) => typeof v === 'function' ? undefined : (v instanceof Element ? '[Element]' : v))); } catch (_) { return '[non sérialisable]'; } };
      const rec = x => { if (log.length < 400) log.push({ t: Math.round(performance.now()), d: ser(x) }); };
      const wrap = a => {
        if (!Array.isArray(a) || a.__st) return a;
        a.forEach(rec);
        const orig = a.push;
        a.push = function () { for (const x of arguments) rec(x); return orig.apply(this, arguments); };
        Object.defineProperty(a, '__st', { value: 1 });
        return a;
      };
      Object.defineProperty(window, 'dataLayer', { configurable: true, get() { return dl; }, set(v) { dl = wrap(v); } });
    } catch (_) {}
  });
  const page = await ctx.newPage();
  const s = { label, ctx, page, t0: Date.now(), step: 'ouverture', log: [], hits: [], urls: [], dl: [], payloads: [], serverCookies: new Set() };
  // cookies posés par un serveur (en-tête Set-Cookie) : seuls ceux-là échappent au plafond de Safari/ITP
  page.on('response', resp => {
    try {
      const sc = resp.headers()['set-cookie'];
      if (!sc) return;
      const host = new URL(resp.url()).hostname;
      for (const line of sc.split(/\n/)) { const name = line.split('=')[0].trim(); if (name) s.serverCookies.add(name + '@' + host); }
    } catch (_) {}
  });
  page.on('request', req => { try { onReq(req); } catch (_) { /* une requête illisible ne doit jamais casser le scan */ } });
  const onReq = req => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    let post = null; try { post = req.postData(); } catch (_) {}
    const t = Date.now() - s.t0;
    s.urls.push(url);
    const hs = parseRequest(url, post);
    for (const h of hs) s.hits.push({ ...h, t, step: s.step, sess: s.label, url: url.slice(0, 300) });
    // garder le payload brut des requêtes de tracking (preuve + validation)
    if (hs.length && hs[0].kind !== 'gtm' && hs[0].kind !== 'gtag' && s.payloads.length < 300) {
      let mime = null; try { mime = req.headers()['content-type'] || null; } catch (_) {}
      s.payloads.push({ t, step: s.step, kind: hs[0].kind, vendor: hs[0].vendor || null, method: req.method(), mime, url: url.slice(0, 500), body: post ? post.slice(0, 2000) : null });
    }
  };
  return s;
}
// Lire le journal dataLayer de la page courante AVANT de la quitter
async function drain(s) {
  try {
    const items = await s.page.evaluate(() => { const l = window.__stDL || []; const out = l.slice(window.__stDrained || 0); window.__stDrained = l.length; return out; });
    for (const it of items) s.dl.push({ step: s.step, d: it.d });
  } catch (_) {}
}
const mark = async (s, step) => { await drain(s); s.step = step; s.log.push({ step, t: Date.now() - s.t0 }); };

// Données structurées JSON-LD (Product / Offer) de la page courante
async function readJsonLd(page) {
  try {
    return await page.evaluate(() => {
      const out = [];
      for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { const j = JSON.parse(sc.textContent); out.push(j); } catch (e) { out.push({ __invalid: String(e.message).slice(0, 80), raw: sc.textContent.slice(0, 120) }); }
      }
      return out;
    });
  } catch (_) { return []; }
}

async function goto(s, url, wait = 4500) {
  let resp;
  try { resp = await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
  catch (e) { return String(e.message || e).split('\n')[0].slice(0, 160); }
  s.status = resp ? resp.status() : null;
  try { await s.page.waitForLoadState('networkidle', { timeout: wait + 3000 }); } catch (_) {}
  await sleep(wait);
  return null;
}

async function scroll(page) {
  try {
    await page.evaluate(async () => {
      const H = () => document.documentElement.scrollHeight;
      for (let y = 0; y < Math.min(H(), 12000); y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 180)); }
      window.scrollTo(0, 0);
    });
  } catch (_) {}
  await sleep(1200);
}

// ---------------------------------------------------------------- CMP
const CMP_SELECTORS = {
  accept: [
    '#axeptio_btn_acceptAll', '#didomi-notice-agree-button', '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept', '#tarteaucitronPersonalize2', '#tarteaucitronAllAllowed', '.cmplz-accept', '#cmplz-accept',
    '#acceptAllButton', '.iubenda-cs-accept-btn', '#cookiescript_accept', '.sd-cmp-elements-button-accept', '[data-cookiefirst-action="accept"]',
    'button[data-testid="uc-accept-all-button"]', '.shopify-pc__banner__btn-accept', '#shopify-pc__banner__btn-accept', '.cc-allow', '.cky-btn-accept', '#wt-cli-accept-all-btn',
    '[data-action="accept-all"]', '.js-accept-cookies', '#hs-eu-confirmation-button', 'button.cookie-accept'
  ],
  refuse: [
    '#axeptio_btn_dismiss', '.onetrust-close-btn-handler', '.ot-pc-refuse-all-handler', '#CybotCookiebotDialogBodyButtonDecline', '.didomi-continue-without-agreeing', '.didomi-continue-without-agreeing', '#didomi-notice-disagree-button', '#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline',
    '#tarteaucitronAllDenied2', '#tarteaucitronAllDenied', '.cmplz-deny', '#cmplz-deny', '.iubenda-cs-reject-btn', '#cookiescript_reject', '.sd-cmp-elements-button-refuse',
    '[data-cookiefirst-action="reject"]', 'button[data-testid="uc-deny-all-button"]', '.shopify-pc__banner__btn-decline', '#shopify-pc__banner__btn-decline', '.cc-deny', '.cky-btn-reject',
    '#wt-cli-reject-btn', '[data-action="reject-all"]', '#hs-eu-decline-button'
  ]
};
const TXT = {
  accept: /^\s*(tout accepter|accepter( tout| et fermer| les cookies| tous les cookies)?|j['’]accepte( tout)?|ok( pour moi)?|oui,? j['’]accepte|accept( all)?( cookies)?|allow( all)?( cookies)?|autoriser( tous)?( les cookies)?|j['’]ai compris|d['’]accord|agree|i agree|c['’]est parti|continuer et accepter)\s*!?\s*$/i,
  refuse: /^\s*(tout refuser|refuser( tout| tous les cookies| les cookies)?|je refuse|continuer sans accepter|non,? merci|reject( all)?|decline( all)?|deny( all)?|refuse( all)?|n[’']?accepter que les (cookies )?(essentiels|nécessaires)|uniquement (les )?(cookies )?(nécessaires|essentiels)|accepter (uniquement )?les (cookies )?(essentiels|nécessaires))\s*$/i
};

async function detectCmp(page) {
  try {
    return await page.evaluate(() => {
      const w = window, h = document.documentElement.innerHTML, q = s => document.querySelector(s);
      // 1) SDK réellement actif / bandeau présent dans le DOM
      if (w.OneTrust || w.OptanonActiveGroups || q('#onetrust-banner-sdk, #onetrust-consent-sdk')) return 'OneTrust';
      if (w.Didomi || q('#didomi-host')) return 'Didomi';
      if (w.Cookiebot || w.CookieConsent && w.CookieConsent.consent || q('#CybotCookiebotDialog')) return 'Cookiebot';
      if (w.axeptioSDK || q('#axeptio_overlay, .axeptio_mount, [id^="axeptio_"]')) return 'Axeptio';
      if (w.tarteaucitron || q('#tarteaucitronRoot')) return 'tarteaucitron';
      if (w.UC_UI || q('#usercentrics-root')) return 'Usercentrics';
      if (w.__cmp && /consentmanager/i.test(h) || q('#cmpbox')) return 'ConsentManager';
      if (w._iub || q('#iubenda-cs-banner')) return 'iubenda';
      if (q('.cmplz-cookiebanner')) return 'Complianz';
      if (q('#sd-cmp, .sd-cmp-elements')) return 'Sirdata';
      if (q('.cookiefirst-root')) return 'CookieFirst';
      if (q('.cky-consent-container')) return 'CookieYes';
      if (q('#shopify-pc__banner, .shopify-pc__banner')) return 'Shopify (bandeau natif)';
      if (typeof w.__tcfapi === 'function') return 'CMP IAB TCF';
      // 2) traces dans le code (bandeau pas encore affiché)
      if (/onetrust|otSDKStub/i.test(h)) return 'OneTrust';
      if (/didomi/i.test(h)) return 'Didomi';
      if (/cookiebot/i.test(h)) return 'Cookiebot';
      if (/axeptio/i.test(h)) return 'Axeptio';
      if (/tarteaucitron/i.test(h)) return 'tarteaucitron';
      if (/usercentrics/i.test(h)) return 'Usercentrics';
      if (/consentmanager\.net/i.test(h)) return 'ConsentManager';
      return null;
    });
  } catch (_) { return null; }
}

// Find a clickable element by selectors or visible text — runs INSIDE each frame,
// pierces open shadow roots, tags the winner with data-st-hit so Playwright can click it.
async function tagInFrame(frame, sels, reSrc, reFlags, scopeSel) {
  return frame.evaluate(([sels, reSrc, reFlags, scopeSel]) => {
    const re = reSrc ? new RegExp(reSrc, reFlags) : null;
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
    const roots = [document];
    const collect = root => root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) { roots.push(el.shadowRoot); collect(el.shadowRoot); } });
    collect(document);
    document.querySelectorAll('[data-st-hit]').forEach(e => e.removeAttribute('data-st-hit'));
    for (const root of roots) for (const sel of sels) {
      let el; try { el = root.querySelector(sel); } catch (_) { continue; }
      if (el && vis(el) && !el.disabled) { el.setAttribute('data-st-hit', '1'); return { how: sel }; }
    }
    if (!re) return null;
    for (const root of roots) {
      const scope = scopeSel ? [...root.querySelectorAll(scopeSel)] : [root];
      for (const sc of scope) for (const el of sc.querySelectorAll('button, [role="button"], a, input[type="submit"], input[type="button"]')) {
        const t = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim().replace(/\s+/g, ' ');
        if (!t || t.length > 60 || !re.test(t) || !vis(el) || el.disabled) continue;
        el.setAttribute('data-st-hit', '1');
        return { how: '« ' + t + ' »' };
      }
    }
    return null;
  }, [sels, reSrc, reFlags, scopeSel]).catch(() => null);
}

async function clickTagged(page, sels, re, { timeoutMs = 12000, scope = null } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      const hit = await tagInFrame(frame, sels, re ? re.source : null, re ? re.flags : '', scope);
      if (!hit) continue;
      try {
        await frame.locator('[data-st-hit="1"]').first().click({ timeout: 3000 });
        return { ok: true, how: hit.how, frame: frame === page.mainFrame() ? 'page' : 'iframe' };
      } catch (_) {
        try { await frame.locator('[data-st-hit="1"]').first().evaluate(el => el.click()); return { ok: true, how: hit.how + ' (clic forcé)', frame: frame === page.mainFrame() ? 'page' : 'iframe' }; } catch (_) {}
      }
    }
    await sleep(1000);
  }
  return { ok: false };
}

// Click the accept / refuse button (banners often show up 5-10 s after load).
// 1) bouton visible  2) bouton présent mais caché (bandeau géolocalisé) → clic JS  3) API de la CMP.
async function clickConsent(page, kind, cmp) {
  const vis = await clickTagged(page, CMP_SELECTORS[kind], TXT[kind], { timeoutMs: 10000 });
  if (vis.ok) return vis;
  for (const frame of page.frames()) {
    const how = await frame.evaluate(sels => {
      for (const sel of sels) { const el = document.querySelector(sel); if (el) { el.click(); return sel; } }
      return null;
    }, CMP_SELECTORS[kind]).catch(() => null);
    if (how) return { ok: true, how: `${how} (bandeau masqué, clic forcé)`, forced: true };
  }
  const api = await page.evaluate(([k, cmp]) => {
    const w = window, yes = k === 'accept';
    const is = n => !cmp || cmp.indexOf(n) === 0;   // n'utiliser QUE l'API de la CMP détectée
    try {
      if (w.OneTrust && is('OneTrust')) { yes ? w.OneTrust.AllowAll() : w.OneTrust.RejectAll(); return 'API OneTrust.' + (yes ? 'AllowAll()' : 'RejectAll()'); }
      if (w.Didomi && is('Didomi')) { yes ? w.Didomi.setUserAgreeToAll() : w.Didomi.setUserDisagreeToAll(); return 'API Didomi.' + (yes ? 'setUserAgreeToAll()' : 'setUserDisagreeToAll()'); }
      if (w.Cookiebot && is('Cookiebot')) { yes ? w.Cookiebot.submitCustomConsent(true, true, true) : w.Cookiebot.decline ? w.Cookiebot.decline() : w.Cookiebot.submitCustomConsent(false, false, false); return 'API Cookiebot'; }
      if (w.UC_UI && is('Usercentrics')) { yes ? w.UC_UI.acceptAllConsents() : w.UC_UI.denyAllConsents(); return 'API Usercentrics'; }
      if (w.tarteaucitron && w.tarteaucitron.userInterface && is('tarteaucitron')) { w.tarteaucitron.userInterface.respondAll(yes); return 'API tarteaucitron.respondAll(' + yes + ')'; }
      if (w.axeptioSDK && w.axeptioSDK.acceptAll && yes && is('Axeptio')) { w.axeptioSDK.acceptAll(); return 'API axeptioSDK.acceptAll()'; }
      if (w.Shopify && w.Shopify.customerPrivacy && w.Shopify.customerPrivacy.setTrackingConsent && is('Shopify')) { w.Shopify.customerPrivacy.setTrackingConsent({ analytics: yes, marketing: yes, preferences: yes, sale_of_data: yes }, () => {}); return 'API Shopify.customerPrivacy'; }
    } catch (e) { return null; }
    return null;
  }, [kind, cmp]).catch(() => null);
  if (api) return { ok: true, how: `${api} (bandeau non affiché)`, forced: true };
  return { ok: false };
}

// ---------------------------------------------------------------- funnel helpers
async function collectLinks(page, base) {
  try {
    return await page.evaluate(b => {
      const host = new URL(b).hostname.replace(/^www\./, '');
      return [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => { try { const u = new URL(h); return u.hostname.replace(/^www\./, '') === host && /^https?:$/.test(u.protocol); } catch (_) { return false; } });
    }, base);
  } catch (_) { return []; }
}
const PRODUCT_RE = /\/products?\/[^/?#]+|\/p\/[^/?#]+|-p-?\d+|\/produit[s]?\/[^/?#]+|\/article\/[^/?#]+|\/[a-z0-9-]+-\d{4,}\.html|\/dp\/|\/item\/[^/?#]+/i;
const CATEGORY_RE = /\/collections?\/[^/?#]+|\/categor(y|ie|ies)\/|\/c\/[^/?#]+|\/shop\/?$|\/boutique|\/femme|\/homme|\/women|\/men|\/nouveautes|\/new/i;
const BAD_RE = /\/(account|compte|login|connexion|cart|panier|checkout|search|recherche|blog|pages?\/|policies|cgv|contact|wishlist|faq)/i;

function pick(links, re) { return U(links).filter(l => re.test(l) && !BAD_RE.test(l))[0] || null; }

async function findProduct(s, origin) {
  let links = await collectLinks(s.page, origin);
  let prod = pick(links, PRODUCT_RE), cat = pick(links, CATEGORY_RE);
  return { prod, cat };
}

const ATC_SEL = ['form[action*="/cart/add"] [type="submit"]:not([disabled])', 'button[name="add"]:not([disabled])', '[data-add-to-cart]:not([disabled])', '#AddToCart:not([disabled])', '.product-form__submit:not([disabled])', 'button.single_add_to_cart_button:not([disabled])', '#add-to-cart', '[data-testid*="add-to-cart" i]', '#product-addtocart-button'];
const ATC_TXT = /^\s*(ajouter au panier|ajouter à mon panier|add to (cart|bag|basket)|ajouter|acheter|je le veux|mettre au panier|ajout au panier)\b/i;

const VARIANT_SEL = ['fieldset input[type="radio"]:not([disabled]):not(:checked) + label', 'variant-picker input:not([disabled]) + label', '.variant-input input:not([disabled]) + label', '[data-option-value]:not(.disabled):not([disabled]):not(.is-disabled)', 'button[data-size]:not([disabled])', '.size-selector button:not([disabled])', '.swatch-element:not(.soldout) label', '[class*="size"] button:not([disabled])'];
async function addToCart(page) {
  for (let round = 0; round < 3; round++) {
    const r = await clickTagged(page, ATC_SEL, ATC_TXT, { timeoutMs: 2500, scope: 'main, form, [class*="product"], body' });
    if (r.ok) return r;
    // probablement une taille / variante à choisir d'abord
    const sel = page.locator('select[name*="option" i]:visible, select[name="id"]:visible').first();
    if (await sel.count().catch(() => 0)) { await sel.selectOption({ index: 1 }).catch(() => {}); await sleep(600); continue; }
    const v = await clickTagged(page, VARIANT_SEL, null, { timeoutMs: 1500 });
    if (!v.ok) break;
    await sleep(800);
  }
  return { ok: false };
}

const CHECKOUT_TXT = /^\s*(commander|passer (à la |la )?commande|valider (mon |le )?panier|paiement|procéder au paiement|aller au paiement|checkout|check out|proceed to checkout|finaliser( ma commande)?)\b/i;
async function goCheckout(page) {
  const sels = ['button[name="checkout"]', 'input[name="checkout"]', '#checkout', '.cart__checkout-button', '[data-testid*="checkout" i]', 'a[href*="/checkout"]', 'a[href*="commande"]'];
  return clickTagged(page, sels, CHECKOUT_TXT, { timeoutMs: 5000 });
}

async function readPage(page) {
  try {
    return await page.evaluate(() => {
      const dl = Array.isArray(window.dataLayer) ? window.dataLayer : [];
      let consentDefault = null, consentUpdate = null; const ecomEvents = [];
      for (const e of dl) {
        try {
          const a = e && typeof e === 'object' && e.length !== undefined ? Array.prototype.slice.call(e) : null;
          if (a && a[0] === 'consent' && a[1] === 'default') consentDefault = a[2] || {};
          if (a && a[0] === 'consent' && a[1] === 'update') consentUpdate = a[2] || {};
          if (e && e.event && e.ecommerce) ecomEvents.push(e.event);
        } catch (_) {}
      }
      let fbIds = []; try { if (window.fbq && fbq.instance && fbq.instance.pixelsByID) fbIds = Object.keys(fbq.instance.pixelsByID); } catch (_) {}
      return {
        title: (document.title || '').slice(0, 90), shopify: !!window.Shopify, woo: !!document.querySelector('body.woocommerce, .woocommerce'),
        presta: !!window.prestashop, wix: !!window.wixBiSession, magento: !!document.querySelector('[data-mage-init], script[src*="mage"]'),
        consentDefault, consentUpdate, ecomEvents, fbIds, hasFbq: typeof window.fbq === 'function', hasGtag: typeof window.gtag === 'function',
        dlLen: dl.length
      };
    });
  } catch (_) { return {}; }
}

// ---------------------------------------------------------------- the scan
async function deepScan(browser, c, opts = {}) {
  const onStep = opts.onStep || (() => {});
  const res = { name: c.name, url: c.url, startedAt: new Date().toISOString(), phases: {}, steps: [] };
  // progression : ~17 étapes au total (les sites sans produit en ont moins : la barre saute alors à 100 %)
  const TOTAL_STEPS = 17; let nStep = 0;
  const say = (k, msg) => { nStep++; const pct = k === 'D' ? 97 : Math.min(95, Math.round(nStep / TOTAL_STEPS * 100)); res.steps.push({ k, msg, t: Date.now(), pct }); onStep(k, msg, pct); };
  let origin; try { origin = new URL(c.url).origin; } catch (_) { origin = c.url; }

  // A — visiteur neuf
  say('A', 'Ouverture de la boutique, comme un visiteur neuf');
  const A = await openSession(browser, 'A');
  await mark(A, 'accueil');
  const errA = await goto(A, c.url, 5000);
  say('A', 'Lecture sans cookie, défilement de la page');
  await scroll(A.page);
  const pA = await readPage(A.page);
  const cmp = await detectCmp(A.page);
  // le bandeau est-il réellement AFFICHÉ ? (sinon : géolocalisation hors UE probable → conclusions prudentes)
  let bannerVisible = null;
  if (cmp) {
    bannerVisible = false;
    for (const fr of A.page.frames()) { if (await tagInFrame(fr, CMP_SELECTORS.accept.concat(CMP_SELECTORS.refuse), TXT.accept.source, TXT.accept.flags, null)) { bannerVisible = true; break; } }
  }
  const wall = await A.page.evaluate(() => {
    const t = (document.title + ' ' + (document.body ? document.body.innerText.slice(0, 600) : '')).toLowerCase();
    const h = document.documentElement.innerHTML;
    return /captcha-delivery|datadome|cf-chl|challenge-platform|perimeterx|px-captcha|incapsula|_Incapsula_|akamai.*bot/i.test(h) || /just a moment|attention required|access denied|accès refusé|vérification|are you a robot|êtes-vous un robot|unusual traffic/.test(t);
  }).catch(() => false);
  if (!errA && ((wall && A.hits.length < 2 && A.urls.length < 40) || (A.status && A.status >= 400 && A.hits.length < 2) || (A.hits.length === 0 && A.urls.length < 15))) {
    res.err = wall ? 'Site protégé contre les robots (anti-bot) : contenu non chargé, rien n\'est affirmé.' : A.status >= 400 ? `Le site répond HTTP ${A.status} au robot : rien n'est affirmé.` : 'Le site n\'a quasiment rien chargé (protection anti-robot probable) : rien n\'est affirmé.';
    res.phases.A = { err: res.err, hits: A.hits, page: pA, cmp, nReq: A.urls.length, dl: [], payloads: A.payloads, jsonld: [] };
    await A.ctx.close(); res.finishedAt = new Date().toISOString(); return res;
  }
  res.finalUrl = A.page.url();
  try { origin = new URL(res.finalUrl).origin; } catch (_) {}
  const nav = errA ? {} : await findProduct(A, origin);
  await drain(A);
  res.phases.A = { err: errA, hits: A.hits, page: pA, cmp, bannerVisible, nReq: A.urls.length, dl: A.dl, payloads: A.payloads, jsonld: await readJsonLd(A.page) };
  await A.ctx.close();
  if (errA && A.hits.length === 0) { res.err = errA; res.finishedAt = new Date().toISOString(); return res; }

  // B — refus
  try {
  say('B', 'Deuxième visite : je cherche le bandeau cookies');
  const B = await openSession(browser, 'B');
  await mark(B, 'accueil');
  await goto(B, c.url, 3500);
  const before = B.hits.length;
  say('B', cmp ? `Bandeau ${cmp} repéré, recherche du bouton « Refuser »` : 'Aucun bandeau cookies repéré pour l’instant, je vérifie encore');
  const refuse = await clickConsent(B.page, 'refuse', cmp);
  say('B', refuse.ok ? 'Clic sur « Refuser » fait, j’observe ce qui part encore' : 'Pas de bouton « Refuser » trouvé, je continue');
  await mark(B, 'après refus');
  await sleep(4000);
  await scroll(B.page);
  if (refuse.ok && (nav.prod || nav.cat)) { await mark(B, 'navigation après refus'); await goto(B, nav.prod || nav.cat, 4000); }
  await drain(B);
  res.phases.B = { refuse, hits: B.hits, hitsBefore: before, page: await readPage(B.page), payloads: B.payloads };
  await B.ctx.close();

  } catch (e) { res.phases.B = { refuse: { ok: false }, hits: [], err: String(e.message || e).slice(0, 140) }; }

  // C — acceptation + parcours d'achat
  try {
  say('C', 'Troisième visite : clic sur « Accepter » puis parcours d’achat');
  const C = await openSession(browser, 'C');
  await mark(C, 'accueil');
  // arrivée « comme depuis une pub » : identifiants de clic Google / Meta / TikTok + UTM
  const CLICK = { gclid: 'STtestGCLID123', fbclid: 'STtestFBCLID123', ttclid: 'STtestTTCLID123' };
  const landing = (() => { try { const u = new URL(c.url); Object.entries(CLICK).forEach(([k, v]) => u.searchParams.set(k, v)); u.searchParams.set('utm_source', 'skilltracking'); u.searchParams.set('utm_medium', 'audit'); return u.toString(); } catch (_) { return c.url; } })();
  await goto(C, landing, 3500);
  const landedUrl = C.page.url();
  say('C', 'J’arrive comme depuis une publicité Google et Meta (identifiants de clic)');
  const accept = await clickConsent(C.page, 'accept', cmp);
  say('C', accept.ok ? 'Clic sur « Accepter » fait, je vérifie que la mesure démarre' : 'Pas de bouton « Accepter » trouvé, je continue');
  await mark(C, 'après acceptation');
  await sleep(4500);
  await scroll(C.page);
  const pC = await readPage(C.page);
  const readCookies = async () => { try { return (await C.ctx.cookies()).map(k => ({ name: k.name, value: String(k.value).slice(0, 80), domain: k.domain, expires: k.expires, httpOnly: k.httpOnly })); } catch (_) { return []; } };
  const clickIds = { landedUrl: landedUrl.slice(0, 300), kept: Object.fromEntries(Object.keys(CLICK).map(k => [k, landedUrl.includes(CLICK[k])])), cookies: (await readCookies()).filter(k => /^(_gcl_|_fbc$|_fbp$|_ttp$|ttclid|_ga$|_ga_|FPID|FPLC|_uetmsclkid)/.test(k.name)) };
  const funnel = { category: null, product: null, addToCart: null, cart: null, checkout: null };

  if (nav.cat) { say('C', 'Visite d\'une page catégorie'); await mark(C, 'catégorie'); funnel.category = { url: nav.cat, err: await goto(C, nav.cat, 3500) }; await scroll(C.page); }
  let prodUrl = nav.prod;
  if (!prodUrl && funnel.category && !funnel.category.err) prodUrl = pick(await collectLinks(C.page, origin), PRODUCT_RE);
  if (!prodUrl && (pA.shopify)) { await goto(C, origin + '/collections/all', 2500); prodUrl = pick(await collectLinks(C.page, origin), /\/products\//); }
  if (prodUrl) {
    say('C', 'Ouverture d\'une fiche produit');
    await mark(C, 'fiche produit'); funnel.product = { url: prodUrl, err: await goto(C, prodUrl, 4500) };
    funnel.product.jsonld = await readJsonLd(C.page);
    say('C', 'Ajout au panier');
    await mark(C, 'ajout panier');
    funnel.addToCart = await addToCart(C.page);
    await sleep(5000);
    say('C', funnel.addToCart && funnel.addToCart.ok ? 'Produit ajouté au panier, j’ouvre le panier' : 'Ajout au panier impossible sur ce produit, j’ouvre le panier');
    await mark(C, 'panier');
    let cartErr = null;
    if (pA.shopify) cartErr = await goto(C, origin + '/cart', 3500);
    else {
      const cl = pick(await collectLinks(C.page, origin).then(l => l), /\/(cart|panier|basket|bag)(\/|$|\?)/i) || origin + '/cart';
      cartErr = await goto(C, cl, 3500);
    }
    funnel.cart = { err: cartErr };
    say('C', 'Passage à l’étape paiement (sans jamais commander)');
    await mark(C, 'checkout');
    funnel.checkout = await goCheckout(C.page);
    if (funnel.checkout.ok) { try { await C.page.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch (_) {} await sleep(6000); funnel.checkout.url = C.page.url().slice(0, 200); }
  }
  await drain(C);
  const finalCookies = (await readCookies()).filter(k => /^(_gcl_|_fbc$|_fbp$|_ttp$|_ga$|_ga_|FPID|FPLC)/.test(k.name));
  res.phases.C = { accept, hits: C.hits, page: pC, funnel, log: C.log, dl: C.dl, payloads: C.payloads, clickIds, finalCookies, serverCookies: [...C.serverCookies].slice(0, 200) };
  await C.ctx.close();
  } catch (e) { res.phases.C = res.phases.C || { accept: { ok: false }, hits: [], funnel: {}, err: String(e.message || e).slice(0, 140) }; }
  say('D', 'Lecture des données envoyées (dataLayer, Meta, Google, cookies)');
  say('D', 'Analyse de ce qui part, et quand');
  res.finishedAt = new Date().toISOString();
  return res;
}

module.exports = { deepScan, parseRequest, qs, CMP_SELECTORS, TXT };
