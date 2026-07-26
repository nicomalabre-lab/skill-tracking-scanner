const { scoreDefects } = require('./scan.js');
let pass = 0, fail = 0;
function check(label, cond) { cond ? pass++ : (fail++, console.log('  FAIL:', label)); }

// A) Double GA4 + Meta pre-consent + client-side only, runs ads → must qualify, top=DOUBLE_GA4 or META (sev5)
let r = scoreDefects({ ga4Fire: ['G-AAAAAAA', 'G-BBBBBBB'], fbFire: ['123456789'], awGads: true, gcs: [], cmp: 'Axeptio', consent: 'none', cf: [], serverGtmHost: [], firstPartyCollect: [], stape: false, uaFire: [] });
check('A qualified', r.qualified === true);
check('A has DOUBLE_GA4', r.defects.some(d => d.code === 'DOUBLE_GA4'));
check('A has META_PRECONSENT', r.defects.some(d => d.code === 'META_PRECONSENT'));
check('A top sev 5', r.top.sev === 5);
check('A runsAds', r.runsAds === true);

// B) Clean server-side setup (Stape), single GA4, consent v2 complete denied, no pixel pre-consent → NOT qualified
r = scoreDefects({ ga4Fire: ['G-CLEAN01'], fbFire: [], awGads: true, gcs: ['G100'], cmp: 'ShopifyNative?', consent: 'default', cf: ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'], serverGtmHost: ['sgtm.brand.com'], firstPartyCollect: ['data.brand.com'], stape: true, uaFire: [] });
check('B not qualified', r.qualified === false);
check('B zero defects', r.defects.length === 0);

// C) Consent v2 incomplete (missing ad_user_data), single GA4, runs ads client-side → qualified, has CONSENT_V2_INCOMPLETE + NO_SERVER_SIDE
r = scoreDefects({ ga4Fire: ['G-XXX0001'], fbFire: [], awGads: true, gcs: ['G100'], cmp: 'Didomi', consent: 'default', cf: ['ad_storage', 'analytics_storage', 'ad_personalization'], serverGtmHost: [], firstPartyCollect: [], stape: false, uaFire: [] });
check('C qualified', r.qualified === true);
check('C has CONSENT_V2_INCOMPLETE', r.defects.some(d => d.code === 'CONSENT_V2_INCOMPLETE'));
check('C has NO_SERVER_SIDE', r.defects.some(d => d.code === 'NO_SERVER_SIDE'));

// D) CMP present, GA4 fires, but no gcs and no consent default → CONSENT_MODE_MISSING
r = scoreDefects({ ga4Fire: ['G-YYY0002'], fbFire: [], awGads: false, gcs: [], cmp: 'Cookiebot', consent: 'none', cf: [], serverGtmHost: [], firstPartyCollect: [], stape: false, uaFire: [] });
check('D has CONSENT_MODE_MISSING', r.defects.some(d => d.code === 'CONSENT_MODE_MISSING'));
check('D qualified (sev4)', r.qualified === true);

// E) No ads at all, single GA4, no defects, server-side present → not qualified (weak prospect)
r = scoreDefects({ ga4Fire: ['G-ZZZ0003'], fbFire: [], awGads: false, gcs: ['G100'], cmp: 'Axeptio', consent: 'default', cf: ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'], serverGtmHost: ['sgtm.brand.com'], firstPartyCollect: [], stape: false, uaFire: [] });
check('E not qualified', r.qualified === false);

// F) GA4 granted-by-default (gcs G111) pre-consent → CONSENT_GRANTED_DEFAULT, qualified
r = scoreDefects({ ga4Fire: ['G-GRANT01'], fbFire: [], awGads: true, gcs: ['G111'], cmp: 'OneTrust', consent: 'none', cf: [], serverGtmHost: ['sgtm.b.com'], firstPartyCollect: [], stape: true, uaFire: [] });
check('F has CONSENT_GRANTED_DEFAULT', r.defects.some(d => d.code === 'CONSENT_GRANTED_DEFAULT'));
check('F qualified', r.qualified === true);

// G) Double Meta pixel
r = scoreDefects({ ga4Fire: ['G-A'], fbFire: ['111111111', '222222222'], awGads: false, gcs: [], cmp: '?', consent: 'none', cf: [], serverGtmHost: [], firstPartyCollect: [], stape: false, uaFire: [] });
check('G has DOUBLE_META', r.defects.some(d => d.code === 'DOUBLE_META'));
check('G has META_PRECONSENT', r.defects.some(d => d.code === 'META_PRECONSENT'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
