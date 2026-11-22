// Alertes email du Radar Skill Tracking — à coller dans un projet Google Apps Script
// créé avec le compte nicolas@skilltracking.fr (script.google.com > Nouveau projet).
// Déployer > Nouveau déploiement > Application Web : « Exécuter en tant que : moi »,
// « Qui a accès : Tout le monde ». Copier l'URL /exec dans la variable WEBHOOK_URL du service Cloud Run.

// Doit être identique à la variable WEBHOOK_KEY du service Cloud Run (protège contre les faux envois).
const CLE = 'REMPLACER_PAR_LA_MEME_CLE_QUE_WEBHOOK_KEY';

// 4 = prospect chaud (rapport ouvert, budget réglé), 5 = lead qualifié ou clic sur un rendez-vous.
// Les leads tièdes (priorité 2) n'envoient pas d'email.
const PRIORITE_MIN = 4;

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return ContentService.createTextOutput('json invalide'); }
  if (d.key !== CLE) return ContentService.createTextOutput('cle invalide');
  if ((d.prio || 0) < PRIORITE_MIN) return ContentService.createTextOutput('ignore');
  const dest = d.email || Session.getActiveUser().getEmail();
  const corps = d.text + (d.url ? '\n\nVoir le rapport : ' + d.url : '') + '\n\n(Alerte automatique du Radar Skill Tracking)';
  MailApp.sendEmail(dest, '[Radar] ' + d.title, corps);
  return ContentService.createTextOutput('ok');
}

// Pour tester depuis l'éditeur : sélectionner « test » puis Exécuter (autoriser l'envoi d'emails la 1re fois).
function test() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), '[Radar] Test des alertes', 'Si tu lis ceci, les alertes email du Radar fonctionnent.');
}
