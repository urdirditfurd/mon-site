#!/usr/bin/env bash
# Lance un Pod ComfyUI RTX 4090 pour le pipeline YouTube long-form.
# Prérequis: export RUNPOD_API_KEY=...  (ou ~/.runpod/config.toml)
set -euo pipefail

NAME="${RUNPOD_POD_NAME:-clipforge-comfyui-4090}"
GPU_ID="${RUNPOD_GPU_ID:-NVIDIA GeForce RTX 4090}"
IMAGE="${RUNPOD_IMAGE:-runpod/comfyui:latest}"
VOLUME_GB="${RUNPOD_VOLUME_GB:-100}"
CONTAINER_GB="${RUNPOD_CONTAINER_GB:-50}"
PORTS="${RUNPOD_PORTS:-8188/http,22/tcp,8080/http}"
CLOUD="${RUNPOD_CLOUD_TYPE:-COMMUNITY}"

if [[ -z "${RUNPOD_API_KEY:-}" ]] && [[ ! -f "${HOME}/.runpod/config.toml" ]]; then
  echo "ERREUR: aucune clé API RunPod."
  echo "1) Crée une clé: https://console.runpod.io/user/settings"
  echo "2) Ajoute des crédits: https://console.runpod.io/user/billing"
  echo "3) export RUNPOD_API_KEY=ta_clé"
  echo "4) Relance: bash scripts/runpod/launch-comfyui-4090.sh"
  exit 1
fi

echo "==> Vérification compte..."
runpodctl user

echo "==> Création Pod: name=$NAME gpu=$GPU_ID image=$IMAGE cloud=$CLOUD"
runpodctl pod create \
  --name "$NAME" \
  --image "$IMAGE" \
  --gpu-id "$GPU_ID" \
  --gpu-count 1 \
  --container-disk-in-gb "$CONTAINER_GB" \
  --volume-in-gb "$VOLUME_GB" \
  --ports "$PORTS" \
  --cloud-type "$CLOUD" \
  --ssh

echo
echo "Pod demandé. Liste:"
runpodctl pod list

echo
echo "Quand le Pod est READY:"
echo "  - Console: https://console.runpod.io/pods"
echo "  - ComfyUI: Connect → HTTP Port 8188"
echo "  - URL type: https://<POD_ID>-8188.proxy.runpod.net"
echo
echo "IMPORTANT: Stop le Pod dès que tu as fini (sinon facturation continue)."
echo "  runpodctl pod stop <POD_ID>"
