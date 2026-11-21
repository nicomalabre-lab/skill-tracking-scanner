// Tests du scan profond : lecture des payloads (GA4 groupé, Meta, TikTok JSON),
// validation dataLayer (schéma GA4), JSON-LD produit, et diagnostic complet sur un scénario simulé.
const assert = require('assert');
const { parseRequest } = require('./deep.js');
const { diagnose, validateEcom, productLd, gcsAd, gcsAn } = require('./controls.js');
let pass = 0, fail = 0;
const check = (label, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('  FAIL:', label, '-', e.message); } };
const has = (d, code, color) => d.controles.some(c => c.code === code && (!color || c.color === color));

// ---------- parsing des requêtes ----------
check('GA4 GET simple', () => {
  const h = parseRequest('https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC1234&en=page_view&gcs=G100&_p=123&_s=1');
  assert.strictEqual(h.length, 1); assert.strictEqual(h[0].kind, 'ga4'); assert.strictEqual(h[0].gcs, 'G100'); assert.strictEqual(h[0].pid, '123');
});
check('GA4 POST groupé (3 événements dans le corps)', () => {
  const body = 'en=view_item&epn.value=29.9&cu=EUR&pr1=id123~nmBonnet\nen=scroll\nen=add_to_cart&epn.value=29.9&cu=EUR&pr1=id123';
  const h = parseRequest('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234&gcs=G111', body);
  assert.deepStrictEqual(h.map(x => x.ev), ['view_item', 'scroll', 'add_to_cart']);
  assert.strictEqual(h[2].value, '29.9'); assert.strictEqual(h[2].currency, 'EUR'); assert.strictEqual(h[2].items, 1);
});
check('GA4 server-side first-party', () => { const h = parseRequest('https://metrics.marque.fr/g/collect?v=2&tid=G-ABC1234&en=page_view'); assert.strictEqual(h[0].firstParty, true); });
check('Meta GET avec eid et valeur', () => {
  const h = parseRequest('https://www.facebook.com/tr/?id=123456789&ev=AddToCart&eid=abc&cd[value]=19.90&cd[currency]=EUR');
  assert.strictEqual(h[0].kind, 'meta'); assert.strictEqual(h[0].ev, 'AddToCart'); assert.strictEqual(h[0].eid, 'abc'); assert.strictEqual(h[0].value, '19.90');
});
check('Meta POST form', () => { const h = parseRequest('https://www.facebook.com/tr/', 'id=987654321&ev=Purchase&cd%5Bvalue%5D=50'); assert.strictEqual(h[0].id, '987654321'); assert.strictEqual(h[0].value, '50'); });
check('TikTok JSON payload', () => { const h = parseRequest('https://analytics.tiktok.com/api/v2/pixel', '{"event":"AddToCart","context":{}}'); assert.strictEqual(h[0].vendor, 'TikTok'); assert.strictEqual(h[0].ev, 'AddToCart'); });
check('Universal Analytics', () => { const h = parseRequest('https://www.google-analytics.com/collect?v=1&tid=UA-123-1&t=pageview'); assert.strictEqual(h[0].kind, 'ua'); });
check('GTM first-party = server-side', () => { const h = parseRequest('https://sgtm.marque.fr/gtm.js?id=GTM-ABCD12'); assert.strictEqual(h[0].kind, 'gtm'); assert.strictEqual(h[0].firstParty, true); });
check('Google Ads avec gcs', () => { const h = parseRequest('https://googleads.g.doubleclick.net/pagead/viewthroughconversion/123/?gcs=G100'); assert.strictEqual(h[0].vendor, 'Google Ads'); assert.strictEqual(h[0].gcs, 'G100'); });
check('URL mal encodée ne plante pas', () => { const h = parseRequest('https://www.facebook.com/tr/?id=123456789&ev=PageView&%E0%A4%A=1&cd[x]=%ZZ'); assert.strictEqual(h[0].id, '123456789'); });
check('requête quelconque ignorée', () => assert.strictEqual(parseRequest('https://cdn.marque.fr/app.js').length, 0));
check('gcs décodé', () => { assert.strictEqual(gcsAd('G110'), true); assert.strictEqual(gcsAn('G110'), false); assert.strictEqual(gcsAn('xx'), null); });

// ---------- dataLayer (schéma GA4) ----------
check('dataLayer conforme', () => {
  const v = validateEcom([{ d: { event: 'add_to_cart', ecommerce: { currency: 'EUR', value: 29.9, items: [{ item_id: 'A1', price: 29.9, quantity: 1 }] } } }]);
  assert.deepStrictEqual(v.issues, []); assert.deepStrictEqual(v.seen, ['add_to_cart']);
});
check('dataLayer non conforme (types + champs)', () => {
  const v = validateEcom([{ d: { event: 'add_to_cart', ecommerce: { currency: 'euro', value: '29,90', items: [{ price: '29,90' }] } } }]);
  assert(v.issues.some(i => /value en string/.test(i)), 'value string');
  assert(v.issues.some(i => /currency « euro »/.test(i)), 'currency');
  assert(v.issues.some(i => /price en string/.test(i)), 'price');
  assert(v.issues.some(i => /sans item_id/.test(i)), 'item_id');
});
check('dataLayer format UA détecté', () => assert(validateEcom([{ d: { event: 'addToCart', ecommerce: { add: { products: [] } } } }]).uaFormat));

// ---------- JSON-LD ----------
check('JSON-LD Product complet', () => { const r = productLd([{ '@type': 'Product', image: 'x', sku: '1', offers: { price: '10', priceCurrency: 'EUR', availability: 'InStock' } }]); assert(r.found); assert.deepStrictEqual(r.missing, []); });
check('JSON-LD dans @graph, incomplet', () => { const r = productLd([{ '@graph': [{ '@type': 'Product', offers: { price: '10' } }] }]); assert(r.found); assert(r.missing.includes('priceCurrency')); });
check('JSON-LD invalide', () => assert.strictEqual(productLd([{ __invalid: 'Unexpected token' }]).invalid, 1));

// ---------- diagnostic complet (scénario simulé) ----------
const H = (o) => ({ t: 400, sess: 'A', step: 'accueil', url: 'https://x/' + (o.ev || ''), host: 'www.google-analytics.com', ...o });
const bad = {
  url: 'https://boutique.fr/', name: 'Boutique',
  phases: {
    A: { cmp: 'Axeptio', nReq: 120, page: {}, dl: [{ d: { 0: 'consent', 1: 'default', 2: { ad_storage: 'denied', analytics_storage: 'denied' } } }], hits: [
      H({ kind: 'meta', id: '111111111', ev: 'PageView', host: 'www.facebook.com' }),
      H({ kind: 'ga4', id: 'G-AAA1111', ev: 'page_view', gcs: 'G111' }),
      H({ kind: 'ga4', id: 'G-BBB2222', ev: 'page_view', gcs: 'G111' }),
      H({ kind: 'ads', vendor: 'TikTok', host: 'analytics.tiktok.com' })
    ] },
    B: { refuse: { ok: true, how: '#axeptio_btn_dismiss' }, hits: [H({ sess: 'B', step: 'après refus', kind: 'meta', id: '111111111', ev: 'PageView', host: 'www.facebook.com' })] },
    C: { accept: { ok: true, how: '#axeptio_btn_acceptAll' }, page: {}, dl: [{ d: { event: 'add_to_cart', ecommerce: { value: '12', items: [] } } }],
      funnel: { product: { url: 'https://boutique.fr/products/a', jsonld: [] }, addToCart: { ok: true, how: 'x' }, checkout: { ok: false } },
      hits: [
        H({ sess: 'C', step: 'après acceptation', kind: 'ga4', id: 'G-AAA1111', ev: 'page_view', gcs: 'G111' }),
        H({ sess: 'C', step: 'fiche produit', kind: 'ga4', id: 'G-AAA1111', ev: 'view_item', gcs: 'G111', pid: '9', seq: '1' }),
        H({ sess: 'C', step: 'fiche produit', kind: 'ga4', id: 'G-AAA1111', ev: 'view_item', gcs: 'G111', pid: '9', seq: '2' }),
        H({ sess: 'C', step: 'fiche produit', kind: 'meta', id: '111111111', ev: 'ViewContent', host: 'www.facebook.com' })
      ] }
  }
};
const d = diagnose(bad);
check('META_PRECONSENT rouge', () => assert(has(d, 'META_PRECONSENT', 'rouge')));
check('CONSENT_GRANTED_DEFAULT rouge', () => assert(has(d, 'CONSENT_GRANTED_DEFAULT', 'rouge')));
check('ADS_PRECONSENT rouge (TikTok)', () => assert(has(d, 'ADS_PRECONSENT', 'rouge')));
check('REFUSE_IGNORED rouge', () => assert(has(d, 'REFUSE_IGNORED', 'rouge')));
check('DOUBLE_GA4 rouge', () => assert(has(d, 'DOUBLE_GA4', 'rouge')));
check('EVENT_DUPLICATED (view_item ×2 même page)', () => assert(has(d, 'EVENT_DUPLICATED', 'rouge')));
check('ADD_TO_CART_MISSING rouge', () => assert(has(d, 'ADD_TO_CART_MISSING', 'rouge')));
check('DL_NOT_SENT rouge', () => assert(has(d, 'DL_NOT_SENT', 'rouge')));
check('DL_SCHEMA orange', () => assert(has(d, 'DL_SCHEMA', 'orange')));
check('CONSENT_V2_INCOMPLETE orange', () => assert(has(d, 'CONSENT_V2_INCOMPLETE', 'orange')));
check('JSONLD_PRODUCT orange', () => assert(has(d, 'JSONLD_PRODUCT', 'orange')));
check('META_DEDUP orange (pas d\'eid)', () => assert(has(d, 'META_DEDUP', 'orange')));
check('BEGIN_CHECKOUT gris (non testé)', () => assert(has(d, 'BEGIN_CHECKOUT_MISSING', 'gris')));
check('qualifié + chaque panne a une accroche', () => { assert(d.qualified); assert(d.defects.every(x => x.hook && x.hook.length > 20)); });
check('tri : rouges d\'abord', () => assert.strictEqual(d.controles[0].color, 'rouge'));

const clean = {
  url: 'https://propre.fr/', name: 'Propre',
  phases: {
    A: { cmp: 'Didomi', nReq: 80, page: {}, dl: [{ d: { 0: 'consent', 1: 'default', 2: { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' } } }], hits: [H({ kind: 'ga4', id: 'G-CLEAN01', ev: 'page_view', gcs: 'G100', host: 'sgtm.propre.fr', firstParty: true })] },
    B: { refuse: { ok: true, how: 'x' }, hits: [H({ sess: 'B', step: 'après refus', kind: 'ga4', id: 'G-CLEAN01', ev: 'page_view', gcs: 'G100' })] },
    C: { accept: { ok: true, how: 'y' }, page: {}, dl: [], funnel: {}, hits: [
      H({ sess: 'C', step: 'après acceptation', kind: 'ga4', id: 'G-CLEAN01', ev: 'page_view', gcs: 'G111', host: 'sgtm.propre.fr', firstParty: true }),
      H({ sess: 'C', step: 'après acceptation', kind: 'meta', id: '222222222', ev: 'PageView', eid: 'e1', host: 'www.facebook.com' })
    ] }
  }
};
const c = diagnose(clean);
check('site propre : aucune panne rouge', () => assert(!c.controles.some(x => x.color === 'rouge'), c.controles.filter(x => x.color === 'rouge').map(x => x.code).join()));
check('site propre : refus respecté (vert)', () => assert(has(c, 'REFUSE_IGNORED', 'vert')));
check('site propre : GA4 attend (vert)', () => assert(has(c, 'GA4_PRECONSENT', 'vert')));
check('site propre : server-side vert', () => assert(has(c, 'NO_SERVER_SIDE', 'vert')));
check('parcours non testé = gris, jamais rouge', () => assert(has(c, 'VIEW_ITEM_MISSING', 'gris')));

const noCmp = { url: 'https://x.fr', phases: { A: { cmp: null, nReq: 50, page: {}, dl: [], hits: [H({ kind: 'meta', id: '333333333', ev: 'PageView', host: 'www.facebook.com' })] } } };
check('aucun bandeau + pixel = NO_CMP rouge', () => assert(has(diagnose(noCmp), 'NO_CMP', 'rouge')));

// géolocalisation : bandeau jamais affiché → pas de rouge sur l'avant-consentement
const geo = JSON.parse(JSON.stringify(bad)); geo.phases.A.bannerVisible = false;
const g = diagnose(geo);
check('bandeau non affiché : META_PRECONSENT passe en orange « à confirmer »', () => { const c = g.controles.find(x => x.code === 'META_PRECONSENT'); assert.strictEqual(c.color, 'orange'); assert(/à confirmer/.test(c.preuve)); });
// accord forcé sans effet → gris, jamais rouge
const forced = JSON.parse(JSON.stringify(clean)); forced.phases.C.accept = { ok: true, forced: true, how: 'API' }; forced.phases.C.hits = [];
check('accord forcé sans effet : gris', () => { const f = diagnose(forced); assert(has(f, 'ACCEPT_NO_MEASURE', 'gris')); assert(!f.controles.some(x => x.color === 'rouge')); });
// accepter introuvable → pas de CONSENT_UPDATE_MISSING
const noAcc = JSON.parse(JSON.stringify(clean)); noAcc.phases.C.accept = { ok: false }; noAcc.phases.C.hits = [H({ sess: 'C', step: 'fiche produit', kind: 'ga4', id: 'G-CLEAN01', ev: 'page_view', gcs: 'G100' })];
check('« Accepter » introuvable : aucun verdict rouge sur la mesure', () => { const f = diagnose(noAcc); assert(!has(f, 'CONSENT_UPDATE_MISSING')); assert(has(f, 'ACCEPT_NO_MEASURE', 'gris')); });

// identifiants de clic & manque à gagner
const { estimateImpact } = require('./controls.js');
const ci = JSON.parse(JSON.stringify(clean));
ci.phases.A.hits.push(H({ kind: 'gtag', id: 'AW-123456', host: 'www.googletagmanager.com' }));
ci.phases.C.clickIds = { landedUrl: 'https://propre.fr/', kept: { gclid: false, fbclid: true, ttclid: false }, cookies: [{ name: '_ga' }] };
ci.phases.C.finalCookies = [{ name: '_ga' }];
ci.phases.C.serverCookies = [];
const dci = diagnose(ci);
check('gclid effacé à l\'arrivée = CLICKID_STRIPPED rouge', () => assert(has(dci, 'CLICKID_STRIPPED', 'rouge')));
check('fbclid gardé mais pas de _fbc = FBC_NOT_STORED orange', () => assert(has(dci, 'FBC_NOT_STORED', 'orange')));
check('_ga posé en JS seulement = COOKIE_ITP orange', () => assert(has(dci, 'COOKIE_ITP', 'orange')));
const fp = JSON.parse(JSON.stringify(ci)); fp.phases.C.finalCookies = [{ name: '_ga' }, { name: 'FPID', httpOnly: true }];
check('cookie FPID (HttpOnly serveur) = COOKIE_ITP vert', () => assert(has(diagnose(fp), 'COOKIE_ITP', 'vert')));
const imp = estimateImpact(dci, { awPresent: true });
check('manque à gagner : fourchette cohérente', () => { assert(imp.high > imp.low && imp.low > 0 && imp.high < 60, JSON.stringify(imp)); assert(imp.levers.every(l => l.source)); });
check('site sans panne = manque à gagner nul', () => { const z = estimateImpact(diagnose(clean)); assert.strictEqual(z.high, 0); });
const basic = JSON.parse(JSON.stringify(clean)); basic.phases.A.hits = [];
check('aucun ping GA4 avant accord = CONSENT_MODE_BASIC', () => assert(has(diagnose(basic), 'CONSENT_MODE_BASIC', 'orange')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
