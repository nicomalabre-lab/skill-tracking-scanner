# Skill Tracking — Scanner autonome de défauts de tracking

Scanner qui tourne **tout seul sur GitHub Actions** (runners avec accès web ouvert), sans
jamais dépendre d'un navigateur local. Chaque matin, il charge la home de chaque marque
candidate dans un contexte *neuf* (sans consentement donné), enregistre les **vraies requêtes
réseau** + le `dataLayer` runtime, et ne signale que des défauts **réellement observés**.
Aucun défaut inventé.

## Architecture (2 moitiés découplées)

1. **Le SCAN** (ce repo, GitHub Actions, cron 08:00 Paris)
   → a besoin d'un navigateur + internet → tourne sur les runners GitHub.
   → produit `qualified.json` (prospects avec défaut observé), commité dans le repo.

2. **Le DRAFTING** (tâche planifiée Cowork, 09:00 Paris)
   → a besoin de Gmail + Notion → tourne côté Cowork.
   → lit `qualified.json`, dédoublonne vs Notion Base A, source le décideur + email,
     crée le brouillon E1 TRACKING (gabarit bgcolor-safe), logue la ligne Notion.

Aucune des deux moitiés ne dépend du PC de Nicolas.

## Fichiers

| Fichier | Rôle |
|---|---|
| `scan.js` | Le cron : lance le scan profond de chaque marque (4 en parallèle). `--quick` = ancien scan accueil seul. |
| `deep.js` | Le robot : 3 sessions, clic bandeau, tunnel d'achat, capture des payloads + dataLayer. |
| `controls.js` | Le diagnostic : feux, preuves, accroches outbound. |
| `test-deep.js` | Tests du moteur profond (`npm test`). |
| `candidates.json` | Le carburant : marques à auditer (`{name, url}`). **Ajoute des marques ici.** |
| `test-scoring.js` | Tests unitaires de la logique de scoring (`npm test`). |
| `server.js` + `app/` | L'application Radar (`npm run app`). |
| `build-index.js` | Génère `history/index.json` pour les tendances. |
| `test-app.js` | Tests de l'app (sécurité URL, API). |
| `.github/workflows/scan.yml` | Le cron GitHub Actions. |
| `qualified.json` | *(généré)* prospects qualifiés, triés par sévérité. |
| `latest-full.json` | *(généré)* tous les résultats bruts (debug). |
| `history/AAAA-MM-JJ.json` | *(généré)* archive quotidienne. |

## Le scan profond (`deep.js` + `controls.js`)

Chaque marque est rejouée par un vrai navigateur, en **3 sessions isolées** (contextes neufs, aucun cookie) :

| Session | Ce que fait le robot | Ce qu'on contrôle |
|---|---|---|
| **A. Visiteur neuf** | ouvre l'accueil, fait défiler, ne clique rien | tout ce qui part **avant** consentement (horodaté : « 0,4 s après ouverture ») |
| **B. Refus** | clique « Refuser » (ou « Continuer sans accepter »), navigue | ce qui part **malgré** le refus — le pire cas CNIL |
| **C. Acceptation + tunnel** | clique « Accepter » → catégorie → fiche produit → **ajout panier** → panier → **checkout** (s'arrête avant tout paiement) | la mesure marche-t-elle ? `view_item`, `add_to_cart`, `begin_checkout`, valeurs, doublons |

Le robot lit aussi **le contenu des échanges** : corps POST (GA4 envoie ses événements groupés, Meta en formulaire, TikTok en JSON), chaque `dataLayer.push` (journalisé), et le JSON-LD des fiches produit.
Si le bandeau ne s'affiche pas (géolocalisation hors UE, cas des serveurs GitHub), le robot clique le bouton masqué ou appelle l'API **de la CMP détectée uniquement** — c'est indiqué dans la preuve.

### Contrôles (un feu par contrôle : 🔴 panne · 🟠 à renforcer · 🟢 OK · ⚪ non vérifié)

| Code | Feu | Observé |
|---|---|---|
| `META_PRECONSENT` | 🔴 S5 | `facebook.com/tr` part avant tout clic |
| `ADS_PRECONSENT` | 🔴 S5 | TikTok, Pinterest, Snap, Criteo, Bing, LinkedIn, Google Ads… avant accord |
| `REFUSE_IGNORED` | 🔴 S5 | des traceurs partent **après « Refuser »** |
| `NO_CMP` | 🔴 S5 | aucun bandeau alors que des traceurs tournent |
| `DOUBLE_GA4` | 🔴 S5 | ≥ 2 propriétés GA4 reçoivent les mêmes visites |
| `CONSENT_GRANTED_DEFAULT` | 🔴 S4 | GA4 `gcs=G111` avant accord |
| `CONSENT_MODE_MISSING` | 🔴 S4 | CMP présente, GA4 sans aucun signal `gcs` |
| `ACCEPT_NO_MEASURE` | 🔴 S4 | après « Accepter », GA4 ou Meta n'envoient rien |
| `CONSENT_UPDATE_MISSING` | 🔴 S4 | après « Accepter », GA4 reste en `G100` |
| `EVENT_DUPLICATED` | 🔴 S4 | même événement ×2 pour un seul chargement (retries réseau exclus via `_p`/`_s`) |
| `ADD_TO_CART_MISSING` | 🔴 S4 | ajout panier réel sans `add_to_cart` / `AddToCart` |
| `DL_NOT_SENT` | 🔴 S4 | événement poussé dans le dataLayer mais jamais envoyé à GA4 |
| `DOUBLE_META` | 🟠 S4 | ≥ 2 pixels Meta |
| `VIEW_ITEM_MISSING` / `BEGIN_CHECKOUT_MISSING` | 🟠 S3 | fiche produit / checkout non mesurés |
| `ECOM_PARAMS` | 🟠 S3 | événements sans `value`, `currency` ou `items`, valeur non numérique |
| `META_DEDUP` | 🟠 S3 | événements Meta sans `eid` (dédup Pixel/CAPI impossible) |
| `DL_SCHEMA` | 🟠 S3 | objets dataLayer hors schéma GA4 (types, `items`, devise ISO 4217…) |
| `DL_UA_FORMAT` | 🟠 S3 | dataLayer au format e-commerce Universal Analytics |
| `CONSENT_V2_INCOMPLETE` | 🟠 S3 | `consent default` sans `ad_user_data` / `ad_personalization` |
| `REFUSE_BUTTON_MISSING` | 🟠 S3 | « Accepter » cliquable, aucun « Refuser » équivalent |
| `ANALYTICS_PRECONSENT` | 🟠 S3 | Hotjar, Clarity, Contentsquare, Matomo… avant accord |
| `LEGACY_UA` | 🟠 S3 | Universal Analytics tire encore |
| `NO_SERVER_SIDE` | 🟠 S3 | pub active, aucune collecte server-side / first-party |
| `JSONLD_PRODUCT` | 🟠 S2 | JSON-LD Produit absent, invalide ou incomplet |

Ce qui n'a pas pu être testé (bandeau introuvable, produit en rupture, site anti-robot) sort **en gris, jamais en rouge**.
Un prospect est **qualifié** s'il a ≥ 1 panne ET fait de la pub (ou une panne S4+).

## L'application — Radar (dashboard + détecteur live)

```bash
npm install
npx playwright install chromium   # une seule fois
npm run app        # → http://localhost:3000
```

| Onglet | Ce que tu fais |
|---|---|
| **Prospects** | KPIs, filtres (défaut, statut, nouveaux), accroche + **email E1 en 1 clic**, statut pipeline + notes, export CSV. |
| **Détecteur** | Colle une URL → scan profond (~2 min) avec les étapes en direct → rapport à feux + payloads capturés → « Ajouter aux marques ». |
| **Tendances** | Courbe des qualifiés / S5 par jour, défauts les plus fréquents, marques entrées/sorties vs veille. |
| **Marques** | Liste de `candidates.json` avec état du dernier scan, ajout / retrait. |

- Statuts + notes → `pipeline.json` (local, non commité : données prospects).
- Scans live → `live-scans.json` (local, non commité).
- **Mode lecture** : `app/` ouvert sur un hébergement statique (ex. GitHub Pages) lit les JSON du repo ; détecteur désactivé, statuts gardés dans le navigateur.
- Sécurité : le détecteur refuse localhost / IP privées ; le serveur écoute sur `127.0.0.1` (changer avec `HOST=` / `PORT=`).
- `history/index.json` (timeline compacte) est régénéré à chaque scan (`npm run index` pour le refaire à la main).

## Lancer à la main

Onglet **Actions → tracking-scan → Run workflow**. Ou en local :
```bash
npm install && npx playwright install chromium
npm test          # vérifie le scoring
npm run scan      # scanne candidates.json → qualified.json
```

## Faire grossir le pipeline

Ouvre `candidates.json`, ajoute des marques (DTC FR solvables qui font de la pub, **hors**
pipeline Notion existant), commit. Le scan les prendra dès le lendemain.
