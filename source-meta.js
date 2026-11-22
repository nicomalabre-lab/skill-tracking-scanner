// Sourcing : trouve des boutiques e-commerce FR qui ont des pubs Meta ACTIVES (bibliothèque publicitaire),
// vérifie que ce sont de vraies boutiques, et ajoute les nouvelles à candidates.json.
//   node source-meta.js            → recherche + ajout (30 max)
//   node source-meta.js --dry      → recherche seule, rien n'est modifié
// Plus une marque a d'annonces actives, plus elle dépense : c'est le meilleur filtre « pas de curieux ».
const fs = require('fs');
const path = require('path');

const KEYWORDS = (process.env.META_KEYWORDS || 'livraison offerte,nouvelle collection,made in france,code promo,boutique en ligne,fabriqué en france,commandez,offre limitée').split(',').map(s => s.trim()).filter(Boolean);
const MAX_ADD = Number(process.env.SOURCE_MAX_ADD) || 30;
const BAD_HOST = /(^|\.)(facebook|fb|instagram|messenger|whatsapp|meta|metastatus|google|youtube|tiktok|amazon|ebay|leboncoin|cdiscount|etsy|vinted|linktr|linktree|bit|apple|play|wa|calendly|typeform|wixsite|blogspot|wordpress|shopify|myshopify)\.[a-z.]+$/i;

const rootHost = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return null; } };

// Voie officielle et fiable : API de la bibliothèque publicitaire (jeton Meta dans META_ADLIB_TOKEN).
// Depuis le DSA, toutes les pubs diffusées dans l'UE y sont, avec le domaine de destination (link caption).
async function searchApi(keyword) {
  const token = process.env.META_ADLIB_TOKEN;
  const params = new URLSearchParams({ search_terms: keyword, ad_reached_countries: "['FR']", ad_active_status: 'ACTIVE', ad_type: 'ALL', fields: 'page_id,page_name,ad_creative_link_captions,ad_creative_link_titles', limit: '250', access_token: token });
  const out = [];
  let url = 'https://graph.facebook.com/v21.0/ads_archive?' + params;
  for (let page = 0; page < 3 && url; page++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    if (j.error) throw new Error('API Meta : ' + (j.error.message || 'erreur'));
    for (const ad of j.data || []) for (const cap of ad.ad_creative_link_captions || []) {
      const host = String(cap).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) out.push({ href: 'https://' + host + '/', page: { slug: ad.page_id, name: ad.page_name }, keyword });
    }
    url = j.paging && j.paging.next;
  }
  return out;
}

async function searchLibrary(browser, keyword) {
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1366, height: 900 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
  const p = await ctx.newPage();
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=FR&media_type=all&q=${encodeURIComponent(keyword)}&search_type=keyword_unordered`;
  const found = [];
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await p.waitForTimeout(7000);
    for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 3500); await p.waitForTimeout(1300); }
    // dans l'ordre du DOM : lien de la Page Facebook (annonceur) puis lien(s) de destination de l'annonce
    const pairs = await p.evaluate(() => {
      const out = []; let page = null;
      for (const a of document.querySelectorAll('a[href]')) {
        let href = a.href; try { const u = new URL(href); if (u.hostname.startsWith('l.facebook.com')) href = u.searchParams.get('u') || href; } catch (_) {}
        let h = ''; try { h = new URL(href).hostname; } catch (_) { continue; }
        if (/facebook\.com$/.test(h)) { const m = href.match(/facebook\.com\/(?!ads|policies|privacy|help)([^/?#]+)\/?$/); if (m) page = { slug: m[1], name: (a.innerText || '').trim().slice(0, 80) }; continue; }
        out.push({ href, page });
      }
      return out;
    });
    for (const x of pairs) found.push({ ...x, keyword });
  } catch (_) {}
  await ctx.close();
  return found;
}

// Vérifie que le domaine est une vraie boutique (panier, plateforme e-commerce) et francophone
async function checkShop(host) {
  try {
    const r = await fetch('https://' + host + '/', { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9' } });
    if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
    const h = (await r.text()).slice(0, 400000);
    const platform = /cdn\.shopify\.com|Shopify\.theme/i.test(h) ? 'Shopify' : /woocommerce/i.test(h) ? 'WooCommerce' : /prestashop/i.test(h) ? 'PrestaShop' : /mage\/|Magento/i.test(h) ? 'Magento' : /wix\.com|wixstatic/i.test(h) ? 'Wix' : null;
    const shop = !!platform || /add[-_ ]to[-_ ]cart|ajouter au panier|\/cart|\/panier|data-product-id/i.test(h);
    const fr = /<html[^>]+lang=["']?fr/i.test(h) || /\.fr$/.test(host) || /(livraison|panier|nouveautés|connexion)/i.test(h);
    const title = (h.match(/<title[^>]*>([^<]{1,90})/i) || [])[1];
    return { ok: shop && fr, platform, fr, shop, title: title ? title.trim() : null, finalUrl: r.url, why: !shop ? 'pas une boutique' : !fr ? 'pas francophone' : null };
  } catch (e) { return { ok: false, why: 'site injoignable' }; }
}

async function run() {
  const dry = process.argv.includes('--dry');
  const useApi = !!process.env.META_ADLIB_TOKEN;
  const { chromium } = require('playwright');
  const browser = useApi ? null : await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  console.log(useApi ? 'Source : API officielle de la bibliothèque publicitaire Meta' : 'Source : lecture de la page (sans jeton API, peut être bridé par Facebook)');
  const byHost = {};
  for (const k of KEYWORDS) {
    let rows = [];
    try { rows = useApi ? await searchApi(k) : await searchLibrary(browser, k); } catch (e) { console.log(`« ${k} » : ${e.message}`); continue; }
    if (!useApi) await new Promise(r => setTimeout(r, 20000 + Math.random() * 20000)); // rythme humain
    for (const r of rows) {
      const host = rootHost(r.href);
      if (!host || BAD_HOST.test(host)) continue;
      const e = byHost[host] = byHost[host] || { host, ads: 0, keywords: new Set(), page: r.page, landing: r.href };
      e.ads++; e.keywords.add(k);
    }
    console.log(`« ${k} » : ${rows.length} liens`);
  }
  if (browser) await browser.close();
  if (!Object.keys(byHost).length) { console.log('Aucun annonceur récupéré (Facebook a sans doute bridé la lecture). Ajoute un jeton META_ADLIB_TOKEN pour passer par l\'API officielle.'); process.exitCode = 0; return; }

  const candidates = JSON.parse(fs.readFileSync(path.join(__dirname, 'candidates.json'), 'utf8'));
  const known = new Set(candidates.map(c => rootHost(c.url)));
  const fresh = Object.values(byHost).filter(e => !known.has(e.host)).sort((a, b) => b.ads - a.ads);
  const kept = [], rejected = [];
  for (const e of fresh) {
    if (kept.length >= MAX_ADD) break;
    const c = await checkShop(e.host);
    const name = (e.page && e.page.name && !/^\d+$/.test(e.page.name) ? e.page.name : null) || (c.title ? c.title.split(/[|\-–·:]/)[0].trim() : e.host);
    (c.ok ? kept : rejected).push({ name, url: c.finalUrl ? new URL(c.finalUrl).origin + '/' : 'https://' + e.host + '/', host: e.host, ads: e.ads, platform: c.platform, why: c.why, keywords: [...e.keywords] });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.join(__dirname, 'sourcing'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'sourcing', `meta-${stamp}.json`), JSON.stringify({ date: stamp, keywords: KEYWORDS, kept, rejected }, null, 1));
  if (!dry && kept.length) {
    for (const k of kept) candidates.push({ name: k.name, url: k.url, source: 'meta-ads', ads: k.ads, addedAt: stamp });
    fs.writeFileSync(path.join(__dirname, 'candidates.json'), JSON.stringify(candidates, null, 1) + '\n');
  }
  console.log(`\n${Object.keys(byHost).length} annonceurs vus · ${fresh.length} nouveaux · ${kept.length} boutiques ${dry ? 'trouvées (test, rien ajouté)' : 'ajoutées à candidates.json'} · ${rejected.length} écartées`);
  kept.forEach(k => console.log(`  + ${k.name} — ${k.host} (${k.ads} annonce(s)${k.platform ? ', ' + k.platform : ''})`));
}

module.exports = { checkShop, rootHost, BAD_HOST };
if (require.main === module) run().catch(e => { console.error('FATAL', e); process.exit(1); });
