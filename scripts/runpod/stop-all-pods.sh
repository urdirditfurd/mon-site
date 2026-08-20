#!/usr/bin/env bash
# Stoppe tous les pods pour éviter la facturation idle.
set -euo pipefail

if [[ -z "${RUNPOD_API_KEY:-}" ]] && [[ ! -f "${HOME}/.runpod/config.toml" ]]; then
  echo "ERREUR: RUNPOD_API_KEY manquante"
  exit 1
fi

echo "==> Pods actuels:"
runpodctl pod list

echo
echo "Pour stopper un pod précis:"
echo "  runpodctl pod stop <POD_ID>"
echo "Pour supprimer:"
echo "  runpodctl pod delete <POD_ID>"
