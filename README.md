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
| `scan.js` | Le scanner (Playwright + scoring des défauts). |
| `candidates.json` | Le carburant : marques à auditer (`{name, url}`). **Ajoute des marques ici.** |
| `test-scoring.js` | Tests unitaires de la logique de scoring (`npm test`). |
| `.github/workflows/scan.yml` | Le cron GitHub Actions. |
| `qualified.json` | *(généré)* prospects qualifiés, triés par sévérité. |
| `latest-full.json` | *(généré)* tous les résultats bruts (debug). |
| `history/AAAA-MM-JJ.json` | *(généré)* archive quotidienne. |

## Défauts détectés (uniquement si observés dans le trafic réel)

| Code | Sév | Ce qui est observé |
|---|---|---|
| `DOUBLE_GA4` | 5 | ≥2 propriétés GA4 reçoivent des hits (double comptage). |
| `META_PRECONSENT` | 5 | `facebook.com/tr` part dès le chargement, sans consentement. |
| `DOUBLE_META` | 4 | ≥2 pixels Meta tirent (dédup cassée). |
| `CONSENT_GRANTED_DEFAULT` | 4 | GA4 envoie `gcs=G111` (granted) avant consentement. |
| `CONSENT_MODE_MISSING` | 4 | CMP présent mais aucun signal Consent Mode branché. |
| `CONSENT_V2_INCOMPLETE` | 3 | `consent default` incomplet (champs v2 manquants). |
| `LEGACY_UA` | 3 | Universal Analytics tire encore (mort depuis 2023). |
| `NO_SERVER_SIDE` | 3 | Aucune collecte server-side détectée alors que des pubs tournent. |

Un prospect est **qualifié** s'il a ≥1 défaut ET qu'il fait de la pub (ou un défaut de sévérité ≥4).

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
