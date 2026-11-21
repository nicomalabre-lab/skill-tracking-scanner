#!/usr/bin/env bash
# Déploie le Radar + détecteur profond sur Google Cloud Run (Europe).
# Usage :  RADAR_PASSWORD='un-mot-de-passe' ./deploy/cloudrun.sh
# Prérequis : gcloud installé et connecté (gcloud auth login), projet GCP choisi (gcloud config set project ...).
set -euo pipefail
: "${RADAR_PASSWORD:?Donne un mot de passe : RADAR_PASSWORD='...' ./deploy/cloudrun.sh}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-skilltracking-radar}"
BUCKET="${BUCKET:-$(gcloud config get-value project)-skilltracking-data}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://radar.skilltracking.fr}"

echo "1/3 · Stockage persistant (notes, statuts, rapports) : gs://$BUCKET"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access

echo "2/3 · Build + déploiement Cloud Run ($REGION)"
gcloud run deploy "$SERVICE" \
  --source . --region "$REGION" --allow-unauthenticated \
  --memory 2Gi --cpu 2 --concurrency 4 --timeout 600 --max-instances 3 \
  --execution-environment gen2 \
  --add-volume name=data,type=cloud-storage,bucket="$BUCKET" --add-volume-mount volume=data,mount-path=/data \
  --set-env-vars "DATA_DIR=/data,GITHUB_DATA_REPO=nicomalabre-lab/skill-tracking-scanner,PUBLIC_BASE_URL=$PUBLIC_BASE_URL,RADAR_PASSWORD=$RADAR_PASSWORD"

echo "3/3 · Adresse du service :"
gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
echo "→ Ensuite : brancher radar.skilltracking.fr (voir README, section Hébergement)."
