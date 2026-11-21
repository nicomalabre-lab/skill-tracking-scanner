// Skill Tracking — diagnostic du scan profond.
// Transforme les observations brutes (deep.js) en CONTRÔLES, au format du détecteur
// skilltracking.fr : un feu par contrôle (rouge / orange / vert / gris), une phrase, la preuve.
// Règle d'or : rouge/orange UNIQUEMENT sur ce qui a été observé. Pas vu = gris.

const U = a => [...new Set(a.filter(Boolean))];
const sec = t => (t / 1000).toFixed(1).replace('.', ',') + ' s';
const short = u => String(u || '').replace(/^https?:\/\//, '').slice(0, 110);

// gcs = G1<ad_storage><analytics_storage>  (1 = accordé, 0 = refusé)
const gcsAd = g => g && /^G1[01][01]$/.test(g) ? g[2] === '1' : null;
const gcsAn = g => g && /^G1[01][01]$/.test(g) ? g[3] === '1' : null;

const GA4_FUNNEL = { 'fiche produit': 'view_item', 'ajout panier': 'add_to_cart', checkout: 'begin_checkout' };
const META_FUNNEL = { 'fiche produit': 'ViewContent', 'ajout panier': 'AddToCart', checkout: 'InitiateCheckout' };
const V2 = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];

// Phrases d'accroche outbound (vouvoiement, concret, chiffré quand possible)
const HOOK = {
  META_PRECONSENT: d => `Votre pixel Meta (${d.id}) se déclenche AVANT le moindre consentement — ${d.when} après l'ouverture de la page, la requête à facebook.com/tr est déjà partie. Risque CNIL, et un signal que Meta finira par filtrer.`,
  ADS_PRECONSENT: d => `${d.vendors} collecte${d.n > 1 ? 'nt' : ''} dès l'arrivée du visiteur, avant tout clic sur votre bandeau cookies. C'est exactement ce que la CNIL sanctionne.`,
  REFUSE_IGNORED: d => `J'ai cliqué « Refuser » sur votre bandeau ${d.cmp} : ${d.vendors} ${d.n > 1 ? 'ont' : 'a'} quand même envoyé des données. Le refus n'est pas respecté — c'est le cas le plus grave aux yeux de la CNIL.`,
  GA4_PRECONSENT: d => `Google Analytics (${d.id}) collecte avant l'accord du visiteur (${d.why}). Non conforme, et ça fausse la modélisation des conversions de Google.`,
  CONSENT_GRANTED_DEFAULT: d => `Votre Consent Mode démarre en « accordé » par défaut (gcs=${d.gcs}) : GA4 collecte avant que l'utilisateur ait accepté. Non conforme, et Google le sait.`,
  CONSENT_MODE_MISSING: d => `Vous avez un bandeau ${d.cmp}, mais il n'est pas branché au Consent Mode de Google : aucun signal de consentement n'accompagne vos hits. Ni conformité propre, ni récupération des conversions par modélisation.`,
  NO_CMP: d => `Aucun bandeau cookies sur votre site, alors que ${d.vendors} tournent. Tout part sans accord.`,
  ACCEPT_NO_MEASURE: d => `J'ai cliqué « Accepter » sur votre bandeau : ${d.what}. Les visiteurs qui disent oui ne sont pas mesurés — vos campagnes optimisent à l'aveugle.`,
  CONSENT_UPDATE_MISSING: d => `Même après « Accepter », GA4 continue d'envoyer gcs=${d.gcs} (refusé). Le consentement n'est jamais transmis à Google : vous perdez les données de vos visiteurs consentants.`,
  DOUBLE_GA4: d => `Deux GA4 tournent en parallèle (${d.ids}) : chaque événement est compté deux fois, vos taux de conversion et votre ROAS sont faux.`,
  DOUBLE_META: d => `Deux pixels Meta tirent sur la même page (${d.ids}) : événements comptés en double, budget optimisé sur des chiffres gonflés.`,
  EVENT_DUPLICATED: d => `Sur votre site, « ${d.ev} » part ${d.n} fois pour une seule action (${d.where}). Vos conversions sont gonflées, et les algos de Meta/Google apprennent sur du faux.`,
  ADD_TO_CART_MISSING: d => `J'ai ajouté un produit à votre panier : ${d.what}. L'étape clé du tunnel est invisible pour vos campagnes.`,
  VIEW_ITEM_MISSING: d => `Sur vos fiches produit, ${d.what}. Impossible pour Meta/Google de reconstruire le parcours et de cibler les visiteurs intéressés.`,
  BEGIN_CHECKOUT_MISSING: d => `En passant au paiement, ${d.what}. Vous ne voyez pas où vos acheteurs décrochent.`,
  ECOM_PARAMS: d => `Vos événements e-commerce partent incomplets (${d.what}) : sans valeur ni devise, Google et Meta ne peuvent pas optimiser sur le chiffre d'affaires.`,
  META_DEDUP: d => `Vos événements Meta partent sans identifiant d'événement (eid) : dès que la Conversions API tourne, chaque conversion risque d'être comptée deux fois.`,
  DL_SCHEMA: d => `Votre dataLayer envoie des objets e-commerce non conformes au format GA4 (${d.what}). GTM transmet donc des données fausses ou vides.`,
  DL_NOT_SENT: d => `Votre site pousse bien « ${d.evs} » dans le dataLayer… mais GTM ne l'envoie jamais à Google Analytics. Les données existent, elles sont perdues en route.`,
  DL_UA_FORMAT: () => `Votre dataLayer est encore au format e-commerce Universal Analytics (ecommerce.detail / add…), mort depuis 2023 : GA4 ne le comprend pas.`,
  LEGACY_UA: d => `Universal Analytics (${d.id}) tire encore sur votre site alors que Google l'a coupé en 2023 : du code mort qui trahit un tracking jamais revu.`,
  CONSENT_V2_INCOMPLETE: d => `Votre Consent Mode v2 est incomplet — il manque ${d.missing} dans la config par défaut. Sur Google Ads, ça bloque la modélisation des conversions.`,
  REFUSE_BUTTON_MISSING: d => `Votre bandeau ${d.cmp} ne propose pas de bouton « Refuser » au même niveau que « Accepter » : la CNIL exige que refuser soit aussi simple qu'accepter.`,
  ANALYTICS_PRECONSENT: d => `${d.vendors} enregistre${d.n > 1 ? 'nt' : ''} vos visiteurs avant leur accord.`,
  JSONLD_PRODUCT: d => `Vos fiches produit n'exposent pas de données structurées Produit complètes (${d.what}) : Google Shopping et Merchant Center s'appuient dessus.`,
  CLICKID_STRIPPED: d => `J'ai ouvert votre site comme après un clic sur une pub (${d.ids} dans l'adresse) : votre site les efface en route. Google et Meta ne peuvent plus relier ces visites à vos campagnes.`,
  GCLID_NOT_STORED: () => `Un visiteur arrive d'une pub Google et accepte les cookies… mais le cookie _gcl_aw n'est jamais créé. Ses achats ne seront pas rattachés à votre campagne : Google Ads apprend sans voir vos ventes.`,
  FBC_NOT_STORED: () => `Un visiteur arrive d'une pub Meta (fbclid) et accepte les cookies, mais le cookie _fbc n'est jamais créé. C'est l'un des signaux que Meta juge prioritaires pour relier une vente à une pub.`,
  CONSENT_MODE_BASIC: () => `Votre Consent Mode est en mode « basique » : avant l'accord, Google ne reçoit rien du tout. En mode avancé, Google indique récupérer en moyenne environ deux fois plus de conversions perdues par modélisation.`,
  COOKIE_ITP: () => `Vos cookies de mesure sont posés en JavaScript, pas par votre serveur : Safari peut raccourcir leur durée de vie, et un visiteur iPhone qui revient acheter plus tard devient un « nouveau » visiteur.`,
  NO_SERVER_SIDE: () => `Tout votre tracking part côté navigateur — aucune collecte server-side détectée. Entre Safari/ITP, les adblockers et le consentement, une part croissante de vos conversions Meta & Google n'arrive jamais.`
};
const CONSEQ = {
  META_PRECONSENT: 'Vous suivez des visiteurs sans leur accord : risque RGPD, et vos données publicitaires sont faussées.',
  GA4_PRECONSENT: 'Des données partent vers Google sans l\'accord du visiteur : risque RGPD.',
  CONSENT_GRANTED_DEFAULT: 'Des données partent vers Google sans l\'accord du visiteur : risque RGPD.',
  ADS_PRECONSENT: 'D\'autres régies publicitaires collectent avant l\'accord du visiteur.',
  ANALYTICS_PRECONSENT: 'Des outils d\'analyse se déclenchent avant l\'accord du visiteur.',
  REFUSE_IGNORED: 'Le visiteur a dit non, ses données partent quand même : le pire cas RGPD.',
  NO_CMP: 'Aucun consentement n\'est demandé : tout le tracking est hors-la-loi.',
  ACCEPT_NO_MEASURE: 'Les visiteurs qui acceptent ne sont pas mesurés : vos campagnes optimisent à l\'aveugle.',
  CONSENT_UPDATE_MISSING: 'Le « oui » du visiteur n\'arrive jamais à Google : données perdues.',
  DOUBLE_GA4: 'Vos chiffres sont gonflés : Meta et Google apprennent sur des données fausses.',
  DOUBLE_META: 'Vos chiffres de publicité sont gonflés : Meta apprend sur des données fausses.',
  EVENT_DUPLICATED: 'Conversions comptées en double : ROAS surestimé.',
  ADD_TO_CART_MISSING: 'Vos campagnes ne voient pas les ajouts au panier.',
  VIEW_ITEM_MISSING: 'Le parcours produit est invisible pour vos campagnes.',
  BEGIN_CHECKOUT_MISSING: 'Le début de commande est invisible : abandon de panier non mesuré.',
  ECOM_PARAMS: 'Sans valeur ni devise, pas d\'optimisation sur le chiffre d\'affaires.',
  META_DEDUP: 'Sans identifiant d\'événement, vos conversions risquent d\'être comptées deux fois entre le Pixel et la CAPI.',
  DL_SCHEMA: 'GTM transmet des données e-commerce fausses ou vides.',
  DL_NOT_SENT: 'La donnée existe sur le site mais n\'arrive jamais dans GA4 : trigger GTM manquant ou cassé.',
  DL_UA_FORMAT: 'Format mort depuis 2023 : GA4 ne lit pas ces données.',
  LEGACY_UA: 'Votre site ne mesure plus rien avec cet outil depuis juillet 2023.',
  CONSENT_V2_INCOMPLETE: 'Google Ads ne peut pas modéliser les conversions post-consentement.',
  REFUSE_BUTTON_MISSING: 'Refuser doit être aussi simple qu\'accepter (CNIL).',
  JSONLD_PRODUCT: 'Données produit incomplètes pour Google Shopping.',
  CLICKID_STRIPPED: 'Les visites payées perdent leur identifiant de clic : attribution cassée.',
  GCLID_NOT_STORED: 'Les ventes issues de Google Ads ne sont pas rattachées aux clics.',
  FBC_NOT_STORED: 'Meta rapproche moins bien les ventes de ses pubs : coût par résultat plus élevé.',
  CONSENT_MODE_BASIC: 'Moins de conversions récupérées par la modélisation de Google.',
  COOKIE_ITP: 'Visiteurs Safari « oubliés » au bout de quelques jours : retours et achats différés mal attribués.',
  NO_SERVER_SIDE: 'Une part croissante des conversions n\'arrive jamais aux plateformes.'
};

function ctl(list, code, color, sev, phrase, preuve, hookData) {
  const c = { code, color, sev: color === 'rouge' || color === 'orange' ? sev : 0, phrase, preuve: preuve || null };
  if (c.sev) { c.conseq = CONSEQ[code] || null; c.hook = HOOK[code] ? HOOK[code](hookData || {}) : phrase; }
  list.push(c);
  return c;
}

// --- validation des objets ecommerce du dataLayer (schéma GA4) -------------
const ECOM_EVENTS = /^(view_item|view_item_list|select_item|add_to_cart|remove_from_cart|view_cart|begin_checkout|add_shipping_info|add_payment_info|purchase|add_to_wishlist)$/;
function validateEcom(dl) {
  const issues = [], seen = [];
  let uaFormat = false;
  for (const { d, step } of dl) {
    if (!d || typeof d !== 'object') continue;
    const ev = d.event, ec = d.ecommerce;
    if (ec && typeof ec === 'object' && (ec.detail || ec.add || ec.checkout || ec.impressions || ec.purchase && ec.purchase.actionField)) uaFormat = true;
    if (!ev || !ECOM_EVENTS.test(ev) || !ec || typeof ec !== 'object') continue;
    seen.push(ev);
    const items = ec.items;
    if (!Array.isArray(items) || !items.length) issues.push(`${ev} : items vide ou absent`);
    else {
      const it = items[0] || {};
      if (!it.item_id && !it.item_name) issues.push(`${ev} : item sans item_id ni item_name`);
      if (it.price !== undefined && typeof it.price !== 'number') issues.push(`${ev} : price en ${typeof it.price} (« ${String(it.price).slice(0, 12)} ») au lieu d'un nombre`);
      if (it.quantity !== undefined && typeof it.quantity !== 'number') issues.push(`${ev} : quantity en ${typeof it.quantity}`);
    }
    if (ev !== 'view_item_list' && ev !== 'select_item') {
      if (ec.value === undefined || ec.value === null || ec.value === '') issues.push(`${ev} : value manquant`);
      else if (typeof ec.value !== 'number') issues.push(`${ev} : value en ${typeof ec.value} (« ${String(ec.value).slice(0, 12)} »)`);
      if (!ec.currency) issues.push(`${ev} : currency manquant`);
      else if (!/^[A-Z]{3}$/.test(ec.currency)) issues.push(`${ev} : currency « ${ec.currency} » non ISO 4217`);
    }
  }
  return { issues: U(issues), seen: U(seen), uaFormat };
}

function consentDefaultFromDl(dl) {
  let def = null;
  for (const { d } of dl || []) {
    if (d && typeof d === 'object' && d['0'] === 'consent' && d['1'] === 'default') def = d['2'] || {};
  }
  return def;
}

function productLd(jsonld) {
  const flat = [];
  const walk = x => { if (!x) return; if (Array.isArray(x)) return x.forEach(walk); if (typeof x !== 'object') return; flat.push(x); if (x['@graph']) walk(x['@graph']); };
  (jsonld || []).forEach(walk);
  const invalid = flat.filter(x => x.__invalid);
  const prod = flat.find(x => /Product|ProductGroup/.test([].concat(x['@type'] || []).join(',')));
  if (!prod) return { found: false, invalid: invalid.length };
  const offers = [].concat(prod.offers || (prod.hasVariant && prod.hasVariant[0] && prod.hasVariant[0].offers) || []);
  const o = offers[0] || {};
  const missing = [];
  if (!o.price && !o.lowPrice && !(o.priceSpecification && o.priceSpecification.price)) missing.push('price');
  if (!o.priceCurrency && !(o.priceSpecification && o.priceSpecification.priceCurrency)) missing.push('priceCurrency');
  if (!o.availability) missing.push('availability');
  if (!prod.image) missing.push('image');
  if (!prod.sku && !prod.gtin13 && !prod.gtin && !prod.mpn) missing.push('sku/gtin');
  return { found: true, missing, invalid: invalid.length };
}

// ============================================================================
function diagnose(res) {
  const A = res.phases.A || { hits: [] }, B = res.phases.B, C = res.phases.C;
  const allHits = [...(A.hits || []), ...((B && B.hits) || []), ...((C && C.hits) || [])];
  const cmp = A.cmp || null;
  const list = [];

  const pre = A.hits || [];                                     // visiteur neuf, aucun clic
  const preGa4 = pre.filter(h => h.kind === 'ga4');
  const preMeta = pre.filter(h => h.kind === 'meta');
  const preAds = pre.filter(h => h.kind === 'ads' && !(h.gcs && gcsAd(h.gcs) === false));
  const preAn = pre.filter(h => h.kind === 'analytics');
  const metaIds = U(allHits.filter(h => h.kind === 'meta').map(h => h.id).concat((A.page && A.page.fbIds) || [], (C && C.page && C.page.fbIds) || []));
  const ga4Ids = U(allHits.filter(h => h.kind === 'ga4').map(h => h.id));
  const adVendors = U(allHits.filter(h => h.kind === 'ads').map(h => h.vendor));
  const runsAds = metaIds.length > 0 || adVendors.length > 0;
  const serverSide = allHits.some(h => (h.kind === 'gtm' || h.kind === 'gtag' || h.kind === 'ga4') && h.firstParty) || allHits.some(h => h.kind === 'stape' || h.kind === 'metaProxy');

  // ---------------------------------------------------------- 1. avant consentement
  if (!cmp && (runsAds || ga4Ids.length)) {
    const vendors = U([metaIds.length ? 'Meta' : null, ga4Ids.length ? 'Google Analytics' : null, ...adVendors]).join(', ');
    ctl(list, 'NO_CMP', 'rouge', 5, 'Je n\'ai trouvé aucun bandeau cookies, alors que des traceurs tournent.', `Traceurs vus : ${vendors}`, { vendors });
  }
  if (preMeta.length) {
    const h = preMeta[0];
    ctl(list, 'META_PRECONSENT', 'rouge', 5, 'Votre Pixel Meta se déclenche avant l\'accord du visiteur.', `facebook.com/tr?id=${h.id}&ev=${h.ev} · ${sec(h.t)} après ouverture`, { id: h.id, when: sec(h.t) });
  } else if (metaIds.length) ctl(list, 'META_PRECONSENT', 'vert', 0, 'Votre Pixel Meta attend l\'accord du visiteur.');

  if (preGa4.length) {
    const granted = preGa4.find(h => gcsAn(h.gcs) === true);
    const noSignal = preGa4.filter(h => !h.gcs);
    if (granted) ctl(list, 'CONSENT_GRANTED_DEFAULT', 'rouge', 4, 'Google Analytics part avant l\'accord, en mode « accordé » par défaut.', `${short(granted.host)}/g/collect?tid=${granted.id}&gcs=${granted.gcs} · ${sec(granted.t)} après ouverture`, { gcs: granted.gcs });
    else if (noSignal.length && cmp) ctl(list, 'CONSENT_MODE_MISSING', 'rouge', 4, `Google Analytics part sans signal de consentement, alors que vous avez ${cmp}.`, `${short(noSignal[0].host)}/g/collect?tid=${noSignal[0].id} sans paramètre gcs · ${sec(noSignal[0].t)} après ouverture`, { cmp });
    else if (preGa4.every(h => gcsAn(h.gcs) === false)) ctl(list, 'GA4_PRECONSENT', 'vert', 0, 'Google Analytics attend l\'accord (pings anonymes du Consent Mode avancé uniquement).', `gcs=${preGa4[0].gcs}`);
  } else if (ga4Ids.length) ctl(list, 'GA4_PRECONSENT', 'vert', 0, 'Google Analytics attend l\'accord du visiteur.');

  if (preAds.length) {
    const vendors = U(preAds.map(h => h.vendor));
    ctl(list, 'ADS_PRECONSENT', 'rouge', 5, `${vendors.join(', ')} collecte${vendors.length > 1 ? 'nt' : ''} avant l'accord du visiteur.`, `${short(preAds[0].url)} · ${sec(preAds[0].t)} après ouverture`, { vendors: vendors.join(', '), n: vendors.length });
  } else if (adVendors.length) ctl(list, 'ADS_PRECONSENT', 'vert', 0, 'Les autres régies publicitaires attendent l\'accord.');

  if (preAn.length) {
    const vendors = U(preAn.map(h => h.vendor));
    ctl(list, 'ANALYTICS_PRECONSENT', 'orange', 3, `${vendors.join(', ')} enregistre${vendors.length > 1 ? 'nt' : ''} avant l'accord du visiteur.`, `${short(preAn[0].url)} · ${sec(preAn[0].t)}`, { vendors: vendors.join(', '), n: vendors.length });
  }

  // Consent Mode v2 (lu dans le dataLayer réellement poussé)
  const def = consentDefaultFromDl(A.dl) || (A.page && A.page.consentDefault);
  if (def) {
    const missing = V2.filter(k => !(k in def));
    if (missing.length) ctl(list, 'CONSENT_V2_INCOMPLETE', 'orange', 3, `Votre Consent Mode v2 est incomplet : il manque ${missing.join(', ')}.`, `dataLayer : consent default ${JSON.stringify(def).slice(0, 140)}`, { missing: missing.join(' et ') });
    else ctl(list, 'CONSENT_V2_INCOMPLETE', 'vert', 0, 'Consent Mode v2 complet (4 signaux déclarés par défaut).');
  }

  // ---------------------------------------------------------- 2. refus
  if (B) {
    if (B.refuse && B.refuse.ok) {
      const after = (B.hits || []).filter(h => h.step !== 'accueil');
      const bad = after.filter(h => h.kind === 'meta' || (h.kind === 'ads' && !(h.gcs && gcsAd(h.gcs) === false)) || h.kind === 'analytics' || (h.kind === 'ga4' && (gcsAn(h.gcs) === true || (!h.gcs && cmp))));
      if (bad.length) {
        const vendors = U(bad.map(h => h.kind === 'meta' ? 'Meta' : h.kind === 'ga4' ? 'Google Analytics' : h.vendor));
        const h = bad[0];
        ctl(list, 'REFUSE_IGNORED', 'rouge', 5, `Après « Refuser », ${vendors.join(', ')} ${vendors.length > 1 ? 'envoient' : 'envoie'} quand même des données.`, `${short(h.url)} · étape « ${h.step} » (clic ${B.refuse.how})`, { cmp: cmp || '', vendors: vendors.join(', '), n: vendors.length });
      } else ctl(list, 'REFUSE_IGNORED', 'vert', 0, 'Le refus est respecté : rien ne part après « Refuser ».', `clic ${B.refuse.how}`);
    } else if (cmp && C && C.accept && C.accept.ok && !C.accept.forced) {
      ctl(list, 'REFUSE_BUTTON_MISSING', 'orange', 3, `Je n'ai pas trouvé de bouton « Refuser » au premier niveau du bandeau ${cmp}.`, `« Accepter » trouvé (${C.accept.how}), aucun « Refuser » équivalent`, { cmp });
    } else if (cmp) ctl(list, 'REFUSE_IGNORED', 'gris', 0, 'Je n\'ai pas pu tester le refus (bouton introuvable).');
  }

  // ---------------------------------------------------------- 3. acceptation
  const postC = C ? (C.hits || []).filter(h => h.step !== 'accueil') : [];
  const accepted = !!(C && C.accept && C.accept.ok);
  const trackingAfter = postC.some(h => h.kind === 'meta' || (h.kind === 'ga4' && gcsAn(h.gcs) !== false));
  // le tunnel n'est jugé que si la mesure est censée tourner : pas de CMP, ou « Accepter » réellement effectif
  const consentOk = !cmp || (accepted && (trackingAfter || !C.accept.forced));
  if (C && cmp && !accepted) ctl(list, 'ACCEPT_NO_MEASURE', 'gris', 0, 'Je n\'ai pas pu cliquer sur « Accepter » : la mesure après accord et le tunnel d\'achat n\'ont pas été jugés.');
  else if (C && cmp && accepted && C.accept.forced && !trackingAfter) ctl(list, 'ACCEPT_NO_MEASURE', 'gris', 0, 'Bandeau non affiché au robot : accord forcé par l\'API, sans effet visible. Mesure après accord non jugée.', C.accept.how);
  if (C && consentOk) {
    const afterAccept = postC.filter(h => h.step === 'après acceptation' || h.step === 'catégorie' || h.step === 'fiche produit');
    const ga4After = postC.filter(h => h.kind === 'ga4');
    const metaAfter = postC.filter(h => h.kind === 'meta');
    const hasGaCode = ga4Ids.length || allHits.some(h => h.kind === 'gtag' && /^G-/.test(h.id || ''));
    const hasMetaCode = metaIds.length || (C.page && C.page.hasFbq);
    const what = [];
    if (hasGaCode && !ga4After.length) what.push('Google Analytics n\'envoie rien');
    if (hasMetaCode && !metaAfter.length) what.push('le Pixel Meta n\'envoie rien');
    if (what.length && accepted && !C.accept.forced && (C.page && !C.err)) {
      ctl(list, 'ACCEPT_NO_MEASURE', 'rouge', 4, `Après « Accepter », ${what.join(' et ')}.`, cmp ? `clic ${C.accept.how}, puis navigation sur ${Object.values(C.funnel || {}).filter(Boolean).length + 1} page(s)` : 'pas de bandeau, navigation complète', { what: what.join(' et ') });
    } else if (accepted && ga4After.length && ga4After.every(h => gcsAn(h.gcs) === false)) {
      ctl(list, 'CONSENT_UPDATE_MISSING', 'rouge', 4, 'Après « Accepter », Google Analytics reste en mode « refusé ».', `gcs=${ga4After[0].gcs} sur ${ga4After.length} hit(s) après acceptation`, { gcs: ga4After[0].gcs });
    } else if (cmp && (ga4After.length || metaAfter.length)) ctl(list, 'ACCEPT_NO_MEASURE', 'vert', 0, 'Après « Accepter », la mesure démarre correctement.', `${ga4After.length} hit(s) GA4, ${metaAfter.length} hit(s) Meta`);
  }

  // ---------------------------------------------------------- 4. doublons
  if (ga4Ids.length >= 2) ctl(list, 'DOUBLE_GA4', 'rouge', 5, `Deux propriétés GA4 reçoivent les mêmes visites (${ga4Ids.join(' + ')}).`, ga4Ids.join(', '), { ids: ga4Ids.join(' + ') });
  else if (ga4Ids.length === 1) ctl(list, 'DOUBLE_GA4', 'vert', 0, 'Chaque visite est comptée une seule fois dans Google Analytics.');
  if (metaIds.length >= 2) ctl(list, 'DOUBLE_META', 'orange', 4, `Deux Pixels Meta tirent sur la même page (${metaIds.join(' + ')}).`, metaIds.join(', '), { ids: metaIds.join(' + ') });

  const byKey = {}, seenSeq = new Set();
  for (const h of allHits) {
    if (h.kind !== 'ga4' && h.kind !== 'meta') continue;
    if (!/^(page_view|view_item|add_to_cart|begin_checkout|purchase|PageView|ViewContent|AddToCart|InitiateCheckout|Purchase)$/.test(h.ev)) continue;
    if (h.kind === 'ga4' && h.seq && h.pid) { const sk = `${h.sess}§${h.pid}§${h.seq}§${h.ev}`; if (seenSeq.has(sk)) continue; seenSeq.add(sk); } // retry réseau ≠ doublon
    if (h.kind === 'meta' && h.eid) { const sk = `${h.sess}§meta§${h.id}§${h.eid}`; if (seenSeq.has(sk)) continue; seenSeq.add(sk); }
    if (h.sess === 'C' && h.step === 'accueil') continue;   // mélange avant / après accord : non jugé
    const k = `${h.sess}§${h.step}§${h.kind}§${h.id}§${h.ev}§${h.kind === 'ga4' ? (h.pid || '') : ''}`;
    (byKey[k] = byKey[k] || []).push(h);
  }
  const dupes = [];
  for (const [k, hs] of Object.entries(byKey)) {
    const [sess, step, kind, id, ev] = k.split('§');
    if (hs.length >= 2) dupes.push({ sess, step, kind, id, ev, n: hs.length });
  }
  if (dupes.length) {
    const d = dupes.sort((a, b) => b.n - a.n)[0];
    ctl(list, 'EVENT_DUPLICATED', 'rouge', 4, `« ${d.ev} » part ${d.n} fois pour un seul chargement de page (${d.step}).`, `${d.kind === 'ga4' ? 'GA4 ' : 'Meta '}${d.id} · ${U(dupes.map(x => `${x.ev}×${x.n} (${x.step})`)).slice(0, 4).join(', ')}`, { ev: d.ev, n: d.n, where: d.step });
  }

  // ---------------------------------------------------------- 5. parcours d'achat
  const F = (C && C.funnel) || {};
  const NEXT = { 'fiche produit': ['fiche produit'], 'ajout panier': ['ajout panier', 'panier'], checkout: ['checkout'] };
  const stepHits = st => postC.filter(h => (NEXT[st] || [st]).includes(h.step));
  if (C && !consentOk && F.product) ctl(list, 'VIEW_ITEM_MISSING', 'gris', 0, 'Tunnel d\'achat parcouru, mais sans consentement effectif : les événements manquants ne sont pas jugés.', short(F.product.url));
  if (C && consentOk) {
    if (!F.product) ctl(list, 'VIEW_ITEM_MISSING', 'gris', 0, 'Je n\'ai pas trouvé de fiche produit à ouvrir : le parcours d\'achat n\'a pas été testé.');
    else if (F.product.err) ctl(list, 'VIEW_ITEM_MISSING', 'gris', 0, 'La fiche produit n\'a pas pu être chargée.', F.product.err);
    else {
      const check = (st, gaEv, metaEv) => {
        const hs = stepHits(st);
        const miss = [];
        if (ga4Ids.length && !hs.some(h => h.kind === 'ga4' && h.ev === gaEv)) miss.push(`GA4 n'envoie pas ${gaEv}`);
        if (metaIds.length && !hs.some(h => h.kind === 'meta' && h.ev === metaEv)) miss.push(`Meta n'envoie pas ${metaEv}`);
        return miss;
      };
      const vi = check('fiche produit', 'view_item', 'ViewContent');
      if (vi.length) ctl(list, 'VIEW_ITEM_MISSING', 'orange', 3, `Sur la fiche produit, ${vi.join(' et ')}.`, short(F.product.url), { what: vi.join(' et ') });
      else ctl(list, 'VIEW_ITEM_MISSING', 'vert', 0, 'La vue produit est mesurée (view_item / ViewContent).', short(F.product.url));

      if (F.addToCart && F.addToCart.ok) {
        const atc = check('ajout panier', 'add_to_cart', 'AddToCart');
        if (atc.length) ctl(list, 'ADD_TO_CART_MISSING', 'rouge', 4, `Après un ajout au panier, ${atc.join(' et ')}.`, `clic ${F.addToCart.how} sur ${short(F.product.url)}`, { what: atc.join(' et ') });
        else ctl(list, 'ADD_TO_CART_MISSING', 'vert', 0, 'L\'ajout au panier est mesuré (add_to_cart / AddToCart).');
      } else ctl(list, 'ADD_TO_CART_MISSING', 'gris', 0, 'Je n\'ai pas réussi à ajouter un produit au panier (variante, stock ou bouton non reconnu).');

      if (F.checkout && F.checkout.ok) {
        const bc = check('checkout', 'begin_checkout', 'InitiateCheckout');
        if (bc.length) ctl(list, 'BEGIN_CHECKOUT_MISSING', 'orange', 3, `Au passage en caisse, ${bc.join(' et ')}.`, `clic ${F.checkout.how}${F.checkout.url ? ' → ' + short(F.checkout.url) : ''}`, { what: bc.join(' et ') });
        else ctl(list, 'BEGIN_CHECKOUT_MISSING', 'vert', 0, 'Le début de commande est mesuré (begin_checkout / InitiateCheckout).');
      } else if (F.addToCart && F.addToCart.ok) ctl(list, 'BEGIN_CHECKOUT_MISSING', 'gris', 0, 'Je n\'ai pas pu passer à l\'étape paiement.');

      // payloads : valeur / devise / items
      const ecomHits = postC.filter(h => (h.kind === 'ga4' && /^(view_item|add_to_cart|begin_checkout)$/.test(h.ev)) || (h.kind === 'meta' && /^(ViewContent|AddToCart|InitiateCheckout)$/.test(h.ev)));
      const pIssues = [];
      for (const h of ecomHits) {
        const v = h.value;
        if (v === null || v === undefined || v === '') pIssues.push(`${h.ev} sans valeur`);
        else if (!/^-?\d+(\.\d+)?$/.test(String(v))) pIssues.push(`${h.ev} : valeur « ${String(v).slice(0, 12)} » non numérique`);
        if (!h.currency) pIssues.push(`${h.ev} sans devise`);
        if (h.kind === 'ga4' && !h.items) pIssues.push(`${h.ev} sans produits (items)`);
      }
      if (pIssues.length) ctl(list, 'ECOM_PARAMS', 'orange', 3, 'Vos événements e-commerce partent incomplets.', U(pIssues).slice(0, 4).join(' · '), { what: U(pIssues).slice(0, 3).join(', ') });
      else if (ecomHits.length) ctl(list, 'ECOM_PARAMS', 'vert', 0, 'Valeur, devise et produits sont bien transmis.');

      const metaStd = postC.filter(h => h.kind === 'meta' && h.ev !== 'PageView');
      if (metaStd.length && metaStd.every(h => !h.eid)) ctl(list, 'META_DEDUP', 'orange', 3, 'Vos événements Meta partent sans identifiant d\'événement (eid).', `${metaStd[0].ev} sans eid`);
      else if (metaStd.length) ctl(list, 'META_DEDUP', 'vert', 0, 'Les événements Meta portent un eid (déduplication Pixel / CAPI possible).');

      // JSON-LD produit
      const ld = productLd(F.product.jsonld);
      if (ld.invalid) ctl(list, 'JSONLD_PRODUCT', 'orange', 3, `${ld.invalid} bloc(s) JSON-LD invalide(s) sur la fiche produit (JSON mal formé).`, short(F.product.url), { what: 'JSON mal formé' });
      else if (!ld.found) ctl(list, 'JSONLD_PRODUCT', 'orange', 2, 'Pas de données structurées Produit (JSON-LD) sur la fiche produit.', short(F.product.url), { what: 'schéma Product absent' });
      else if (ld.missing.length) ctl(list, 'JSONLD_PRODUCT', 'orange', 2, `Données structurées Produit incomplètes : ${ld.missing.join(', ')}.`, short(F.product.url), { what: 'manque ' + ld.missing.join(', ') });
      else ctl(list, 'JSONLD_PRODUCT', 'vert', 0, 'Données structurées Produit complètes (prix, devise, dispo, image, sku).');
    }

    // dataLayer — validation façon JSON Schema GA4
    const v = validateEcom([...(A.dl || []), ...((C && C.dl) || [])]);
    if (v.uaFormat) ctl(list, 'DL_UA_FORMAT', 'orange', 3, 'Votre dataLayer est encore au format e-commerce Universal Analytics.', 'ecommerce.detail / ecommerce.add détectés');
    const ga4Evs = new Set(postC.filter(h => h.kind === 'ga4').map(h => h.ev));
    const notSent = ga4Ids.length ? v.seen.filter(e => /^(view_item|add_to_cart|begin_checkout|view_cart|purchase)$/.test(e) && !ga4Evs.has(e)) : [];
    if (notSent.length) ctl(list, 'DL_NOT_SENT', /add_to_cart|begin_checkout|purchase/.test(notSent.join()) ? 'rouge' : 'orange', /add_to_cart|begin_checkout|purchase/.test(notSent.join()) ? 4 : 3, `${notSent.join(', ')} ${notSent.length > 1 ? 'sont poussés' : 'est poussé'} dans le dataLayer mais jamais envoyé${notSent.length > 1 ? 's' : ''} à GA4.`, `dataLayer.push({event: "${notSent[0]}"}) observé · aucune requête /g/collect en=${notSent[0]}`, { evs: notSent.join(', ') });
    if (v.issues.length) ctl(list, 'DL_SCHEMA', 'orange', 3, 'Des objets e-commerce du dataLayer ne respectent pas le schéma GA4.', v.issues.slice(0, 4).join(' · '), { what: v.issues.slice(0, 2).join(', ') });
    else if (v.seen.length) ctl(list, 'DL_SCHEMA', 'vert', 0, `dataLayer e-commerce conforme au schéma GA4 (${v.seen.join(', ')}).`);
  }

  // ---------------------------------------------------------- 5b. identifiants de clic, cookies, Consent Mode
  const CI = C && C.clickIds;
  const awPresent = allHits.some(h => (h.kind === 'gtag' && /^AW-/.test(h.id || '')) || (h.kind === 'ads' && h.vendor === 'Google Ads'));
  if (CI && C.accept !== undefined) {
    const lost = Object.entries(CI.kept || {}).filter(([k, v]) => !v && (k !== 'ttclid' || adVendors.includes('TikTok')) && (k !== 'fbclid' || metaIds.length) && (k !== 'gclid' || awPresent || ga4Ids.length)).map(([k]) => k);
    if (lost.length) ctl(list, 'CLICKID_STRIPPED', 'rouge', 4, `Votre site efface ${lost.join(', ')} de l'adresse à l'arrivée : les visites payées perdent leur identifiant de clic.`, `arrivée sur …?${lost.map(k => k + '=…').join('&')} → ${short(CI.landedUrl)}`, { ids: lost.join(', ') });
    const cookieNames = new Set([...(CI.cookies || []), ...((C.finalCookies) || [])].map(k => k.name));
    if (consentOk && accepted !== false) {
      if (awPresent && (CI.kept || {}).gclid) {
        if (![...cookieNames].some(n => /^_gcl_(aw|gb|ag)/.test(n))) ctl(list, 'GCLID_NOT_STORED', 'rouge', 4, 'Après un clic Google Ads et « Accepter », le cookie _gcl_aw n\'est jamais créé.', 'arrivée avec gclid=…, accord donné, aucun cookie _gcl_aw / _gcl_gb', {});
        else ctl(list, 'GCLID_NOT_STORED', 'vert', 0, 'Le clic Google Ads est bien mémorisé (_gcl_aw).');
      }
      if (metaIds.length && (CI.kept || {}).fbclid) {
        if (!cookieNames.has('_fbc')) ctl(list, 'FBC_NOT_STORED', 'orange', 3, 'Après un clic Meta (fbclid) et « Accepter », le cookie _fbc n\'est jamais créé.', 'arrivée avec fbclid=…, accord donné, aucun cookie _fbc', {});
        else ctl(list, 'FBC_NOT_STORED', 'vert', 0, 'Le clic Meta est bien mémorisé (_fbc).');
      }
    }
    // cookies d'identité posés par le serveur (Set-Cookie) ou seulement en JavaScript ?
    const sc = C.serverCookies || [];
    const siteHost = (() => { try { return new URL(res.finalUrl || res.url).hostname.split('.').slice(-2).join('.'); } catch (_) { return ''; } })();
    const allCk = [...(CI.cookies || []), ...(C.finalCookies || [])];
    // un cookie HttpOnly ne peut être posé QUE par un serveur ; FPID/FPLC = cookies server-side de Google
    const idServer = allCk.some(k => k.name === 'FPID' || k.name === 'FPLC' || (k.httpOnly && /^(_ga|_fbp|_gcl_aw|_ga_)/.test(k.name))) || sc.some(x => /^(FPID|_ga|_fbp|_gcl_aw|FPLC|_ga_[A-Z0-9]+)@/.test(x) && x.endsWith(siteHost));
    if (runsAds && cookieNames.has('_ga') && !idServer) ctl(list, 'COOKIE_ITP', 'orange', 2, 'Vos cookies de mesure (_ga, _fbp…) sont posés en JavaScript : Safari peut raccourcir leur durée de vie.', 'aucun en-tête Set-Cookie serveur pour _ga / FPID / _fbp sur le domaine du site', {});
    else if (idServer) ctl(list, 'COOKIE_ITP', 'vert', 0, 'Cookies de mesure posés par votre serveur (résistent mieux à Safari/ITP).');
  }
  // Consent Mode basique : CMP + GA4 actif après accord, mais AUCUN ping avant accord
  if (cmp && ga4Ids.length && !preGa4.length && postC.some(h => h.kind === 'ga4') && accepted) {
    ctl(list, 'CONSENT_MODE_BASIC', 'orange', 3, 'Consent Mode « basique » : avant l\'accord, Google ne reçoit aucun signal anonyme.', 'zéro requête GA4 avant accord, GA4 actif après « Accepter »', {});
  }

  // ---------------------------------------------------------- 6. héritage & architecture
  const ua = allHits.find(h => h.kind === 'ua');
  if (ua) ctl(list, 'LEGACY_UA', 'orange', 3, 'L\'ancien Google Analytics (Universal) tire encore.', `tid=${ua.id}`, { id: ua.id });
  if (runsAds) {
    if (serverSide) ctl(list, 'NO_SERVER_SIDE', 'vert', 0, 'Tracking server-side détecté.');
    else ctl(list, 'NO_SERVER_SIDE', 'orange', 3, 'Tout le tracking part du navigateur : aucune collecte server-side.', 'GTM / GA4 chargés depuis les domaines Google, aucun endpoint first-party', {});
  }

  // Bandeau jamais affiché pendant la visite « neuve » : la CMP a pu tout autoriser d'office (visiteur hors UE).
  // On ne conclut pas en rouge sur l'« avant consentement » : orange + mention « à confirmer ».
  if (cmp && A.bannerVisible === false) {
    const geoCodes = ['META_PRECONSENT', 'ADS_PRECONSENT', 'CONSENT_GRANTED_DEFAULT', 'CONSENT_MODE_MISSING', 'ANALYTICS_PRECONSENT'];
    if (B && B.refuse && B.refuse.forced) geoCodes.push('REFUSE_IGNORED');
    for (const c of list) if (geoCodes.includes(c.code) && c.color === 'rouge') {
      c.color = 'orange'; c.sev = Math.min(c.sev, 3); c.aConfirmer = true;
      c.preuve = (c.preuve ? c.preuve + ' · ' : '') + 'bandeau cookies non affiché au robot (géolocalisation probable) : à confirmer depuis la France';
    }
  }

  // ---------------------------------------------------------- tri + synthèse
  const ORDER = { rouge: 0, orange: 1, gris: 2, vert: 3 };
  list.sort((a, b) => ORDER[a.color] - ORDER[b.color] || b.sev - a.sev);
  const defects = list.filter(c => c.sev).map(c => ({ code: c.code, sev: c.sev, evidence: c.preuve || c.phrase, hook: c.hook, phrase: c.phrase, conseq: c.conseq, color: c.color }));
  const qualified = defects.length > 0 && (runsAds || defects.some(d => d.sev >= 4));
  return { controles: list, defects, top: defects[0] || null, qualified, runsAds, serverSide, metaIds, ga4Ids, adVendors };
}

// ============================================================================
// MANQUE À GAGNER — ordres de grandeur tirés UNIQUEMENT de chiffres publiés par Meta et Google.
// Chaque levier = % de performance publicitaire (conversions mesurées / coût par résultat) récupérable.
const LEVERS = [
  { id: 'capi', codes: ['NO_SERVER_SIDE', 'META_DEDUP'], need: r => r.metaIds.length, pct: 13, label: 'Conversions API Meta + Pixel (dédupliqués)',
    source: 'Meta : −13 % de coût par acquisition en moyenne (28 tests A/B, 2022)', url: 'https://developers.facebook.com/docs/marketing-api/conversions-api' },
  { id: 'firstparty', codes: ['NO_SERVER_SIDE', 'COOKIE_ITP'], need: r => r.ga4Ids.length || r.awPresent, pct: 14, label: 'Mesure Google en first-party (tag gateway / server-side)',
    source: 'Google : +14 % de conversions observées en moyenne avec Google tag gateway', url: 'https://support.google.com/google-ads/answer/16214371' },
  { id: 'consent', codes: ['CONSENT_MODE_MISSING', 'CONSENT_MODE_BASIC', 'CONSENT_UPDATE_MISSING', 'CONSENT_V2_INCOMPLETE'], need: r => r.ga4Ids.length, pct: 10, label: 'Consent Mode v2 avancé',
    source: 'Google : la modélisation récupère plus de 70 % des parcours clic→conversion perdus au refus des cookies (≈2× plus en mode avancé). 10 % = hypothèse prudente Skill Tracking selon le taux de refus', url: 'https://support.google.com/google-ads/answer/11954524' },
  { id: 'clickid', codes: ['CLICKID_STRIPPED', 'GCLID_NOT_STORED', 'FBC_NOT_STORED'], need: () => true, pct: 10, label: 'Identifiants de clic conservés (gclid, fbclid → _gcl_aw, _fbc)',
    source: 'Meta : fbc est un paramètre prioritaire de la qualité de correspondance (EMQ) ; Google : sans gclid, la vente n\'est pas reliée au clic. 10 % = estimation Skill Tracking', url: 'https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc' },
  { id: 'funnel', codes: ['ADD_TO_CART_MISSING', 'BEGIN_CHECKOUT_MISSING', 'VIEW_ITEM_MISSING', 'DL_NOT_SENT', 'ECOM_PARAMS', 'DL_SCHEMA'], need: () => true, pct: 8, label: 'Tunnel e-commerce complet (vue produit, panier, checkout, valeur)',
    source: 'Sans ces signaux, les campagnes optimisent sur moins d\'étapes et sans valeur (ordre de grandeur Skill Tracking)', url: null }
];
// Doublons : ce n'est pas un « manque », c'est un pilotage faussé → signalé à part.
function estimateImpact(d, extra = {}) {
  const codes = new Set(d.defects.map(x => x.code));
  const r = { metaIds: d.metaIds, ga4Ids: d.ga4Ids, awPresent: !!extra.awPresent };
  const levers = LEVERS.filter(l => l.need(r) && l.codes.some(c => codes.has(c))).map(l => ({ id: l.id, label: l.label, pct: l.pct, source: l.source, url: l.url, codes: l.codes.filter(c => codes.has(c)) }));
  // effets combinés multiplicativement (pas additionnés), fourchette basse = moitié de l'effet publié
  const comb = f => Math.round((1 - levers.reduce((acc, l) => acc * (1 - f * l.pct / 100), 1)) * 100);
  const inflated = ['DOUBLE_GA4', 'DOUBLE_META', 'EVENT_DUPLICATED'].filter(c => codes.has(c));
  const legal = ['META_PRECONSENT', 'ADS_PRECONSENT', 'REFUSE_IGNORED', 'NO_CMP', 'CONSENT_GRANTED_DEFAULT'].filter(c => codes.has(c));
  return { levers, low: comb(0.5), high: comb(1), inflated, legal, note: 'Ordre de grandeur : effets moyens publiés par Meta et Google, combinés sans double compte. Le chiffre réel dépend du site et des campagnes.' };
}

// Format compatible avec l'app / qualified.json (champs « plats » pour les puces)
function toRecord(res) {
  const A = res.phases.A || { hits: [] }, C = res.phases.C || {};
  const all = [...(A.hits || []), ...((res.phases.B && res.phases.B.hits) || []), ...(C.hits || [])];
  const d = diagnose(res);
  const vendors = d.adVendors;
  const awPresent = all.some(h => (h.kind === 'gtag' && /^AW-/.test(h.id || '')) || (h.kind === 'ads' && h.vendor === 'Google Ads'));
  const host = (() => { try { return new URL(res.url).hostname.replace(/^www\./, ''); } catch (_) { return res.url; } })();
  const def = consentDefaultFromDl(A.dl) || (A.page && A.page.consentDefault);
  const p = A.page || {};
  return {
    name: res.name || host, host, url: res.url, err: res.err || null, deep: true,
    ga4Fire: d.ga4Ids, uaFire: U(all.filter(h => h.kind === 'ua').map(h => h.id)), gcs: U((A.hits || []).filter(h => h.kind === 'ga4').map(h => h.gcs)),
    awGads: vendors.includes('Google Ads'), fbFire: d.metaIds, tt: vendors.includes('TikTok'), pin: vendors.includes('Pinterest'), snap: vendors.includes('Snapchat'), crit: vendors.includes('Criteo'),
    otherAds: vendors.filter(v => !['Google Ads', 'TikTok', 'Pinterest', 'Snapchat', 'Criteo'].includes(v)),
    analytics: U(all.filter(h => h.kind === 'analytics').map(h => h.vendor)),
    gtmIds: U(all.filter(h => h.kind === 'gtm').map(h => h.id)),
    serverGtmHost: U(all.filter(h => (h.kind === 'gtm' || h.kind === 'gtag') && h.firstParty).map(h => h.host)),
    firstPartyCollect: U(all.filter(h => h.kind === 'ga4' && h.firstParty).map(h => h.host)),
    stape: all.some(h => h.kind === 'stape'),
    consent: def ? 'default' : 'none', cf: def ? Object.keys(def) : [], cmp: A.cmp || '?',
    platform: p.shopify ? 'Shopify' : p.woo ? 'WooCommerce' : p.presta ? 'PrestaShop' : p.magento ? 'Magento' : p.wix ? 'Wix' : null,
    shopify: !!p.shopify, title: p.title, nReq: A.nReq,
    runsAds: d.runsAds, qualified: d.qualified, defects: d.defects, top: d.top, controles: d.controles,
    impact: estimateImpact(d, { awPresent }),
    clickIds: C.clickIds ? { kept: C.clickIds.kept, cookies: U([...(C.clickIds.cookies || []), ...(C.finalCookies || [])].map(k => k.name)) } : null,
    parcours: {
      refus: res.phases.B ? !!(res.phases.B.refuse && res.phases.B.refuse.ok) : null,
      acceptation: C.accept ? !!C.accept.ok : null,
      produit: C.funnel && C.funnel.product ? short(C.funnel.product.url) : null,
      panier: C.funnel && C.funnel.addToCart ? !!C.funnel.addToCart.ok : null,
      checkout: C.funnel && C.funnel.checkout ? !!C.funnel.checkout.ok : null
    },
    endpoints: U(all.filter(h => !['gtm', 'gtag'].includes(h.kind)).map(h => h.host)).slice(0, 40),
    payloads: [...(A.payloads || []), ...((res.phases.B && res.phases.B.payloads) || []), ...(C.payloads || [])].slice(0, 60),
    scannedAt: res.finishedAt || new Date().toISOString(),
    durationS: res.startedAt && res.finishedAt ? Math.round((new Date(res.finishedAt) - new Date(res.startedAt)) / 1000) : null
  };
}

module.exports = { diagnose, toRecord, validateEcom, productLd, gcsAd, gcsAn, estimateImpact, LEVERS };
