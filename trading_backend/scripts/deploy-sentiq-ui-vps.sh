#!/usr/bin/env bash
# =============================================================================
# SentiQ — Déploiement UI sur VPS (trading.agent-leads.fr)
# Usage : bash deploy-sentiq-ui-vps.sh
# À lancer SUR le VPS après : ssh root@51.254.135.158
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[SentiQ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[SentiQ]${NC} $*"; }
error() { echo -e "${RED}[SentiQ]${NC} $*" >&2; }

# --- 1. Repérer le projet ---
PROJECT_DIR=""
for candidate in \
  /opt/trading_backend \
  /opt/mon-site/trading_backend \
  /root/trading_backend \
  /var/www/trading_backend \
  /home/*/trading_backend; do
  if [[ -f "${candidate}/app/main.py" ]]; then
    PROJECT_DIR="$candidate"
    break
  fi
done

if [[ -z "$PROJECT_DIR" ]]; then
  warn "Projet non trouvé automatiquement. Recherche…"
  PROJECT_DIR=$(find /opt /root /var/www /home -maxdepth 4 -name "main.py" -path "*/app/main.py" 2>/dev/null | head -1 | xargs dirname 2>/dev/null | xargs dirname 2>/dev/null || true)
fi

if [[ -z "$PROJECT_DIR" || ! -f "$PROJECT_DIR/app/main.py" ]]; then
  error "Impossible de trouver trading_backend. Indiquez le chemin :"
  echo "  export PROJECT_DIR=/chemin/vers/trading_backend"
  echo "  bash $0"
  exit 1
fi

info "Projet trouvé : $PROJECT_DIR"
WEB_DIR="$PROJECT_DIR/app/web"
UI_NEW="$WEB_DIR/sentiq.html"
UI_TARGET="$WEB_DIR/dashboard.html"

# --- 2. Sauvegarde ---
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p "$WEB_DIR/backups"
for f in dashboard.html sentiq.html; do
  if [[ -f "$WEB_DIR/$f" ]]; then
    cp "$WEB_DIR/$f" "$WEB_DIR/backups/${f}.${TS}.bak"
    info "Sauvegarde : backups/${f}.${TS}.bak"
  fi
done

# --- 3. Copier sentiq.html si présent, sinon git pull ---
if [[ ! -f "$UI_NEW" ]]; then
  warn "sentiq.html absent — tentative git pull…"
  cd "$(dirname "$PROJECT_DIR")" 2>/dev/null || cd "$PROJECT_DIR"
  if git rev-parse --git-dir >/dev/null 2>&1; then
    git pull origin main || git pull || true
  fi
fi

if [[ ! -f "$UI_NEW" ]]; then
  error "Fichier $UI_NEW introuvable."
  error "Sur votre PC, poussez le repo puis sur le VPS :"
  error "  cd $(dirname "$PROJECT_DIR") && git pull"
  error "Ou copiez le fichier :"
  error "  scp trading_backend/app/web/sentiq.html root@51.254.135.158:$UI_NEW"
  exit 1
fi

# --- 4. Déployer : sentiq.html devient la page /ui ---
cp "$UI_NEW" "$UI_TARGET"
info "UI déployée → $UI_TARGET"

# --- 5. Nettoyer les anciens libellés « connecté » si fichier custom ailleurs ---
info "Recherche d'anciens libellés « connecté » sur le serveur…"
grep -rl "connecté\|SentiQ - connecté\|simulation SentiQ" "$WEB_DIR" 2>/dev/null | while read -r f; do
  sed -i 's/simulation SentiQ - connecté//gi' "$f"
  sed -i 's/SentiQ - connecté//gi' "$f"
  sed -i 's/ - connecté//g' "$f"
  sed -i 's/- connecté//g' "$f"
  sed -i 's/En attente de configuration\./Seuil non chargé — ajustez-le ci-dessous puis Enregistrer./g' "$f"
  info "Nettoyé : $f"
done

# --- 6. Route UI → sentiq (patch ui_routes.py si besoin) ---
UI_ROUTES="$PROJECT_DIR/app/api/ui_routes.py"
if [[ -f "$UI_ROUTES" ]] && ! grep -q "sentiq.html" "$UI_ROUTES"; then
  info "Mise à jour ui_routes.py pour servir sentiq.html"
  cat > "$UI_ROUTES" << 'PYEOF'
"""UI route for the SentiQ dashboard."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

router = APIRouter(tags=["UI"])

_WEB_DIR = Path(__file__).resolve().parents[1] / "web"
_DASHBOARD_FILE = _WEB_DIR / "sentiq.html"
_FALLBACK = _WEB_DIR / "dashboard.html"


@router.get("/", include_in_schema=False)
async def root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/ui", status_code=307)


@router.get("/ui", include_in_schema=False)
async def ui_dashboard() -> FileResponse:
    target = _DASHBOARD_FILE if _DASHBOARD_FILE.exists() else _FALLBACK
    return FileResponse(target)
PYEOF
fi

# --- 7. Endpoint e-mail confirmation connexion (optionnel) ---
AUTH_ROUTES="$PROJECT_DIR/app/api/auth_routes.py"
if [[ -f "$AUTH_ROUTES" ]] && ! grep -q "login-confirmation" "$AUTH_ROUTES"; then
  info "Ajout endpoint POST /api/auth/login-confirmation (log audit)"
  cat >> "$AUTH_ROUTES" << 'PYEOF'


@router.post("/login-confirmation", status_code=status.HTTP_202_ACCEPTED)
async def login_confirmation(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Enregistre une demande de confirmation e-mail (SMTP à configurer en prod)."""
    await log_audit_event(
        session,
        source="auth_api",
        event_type="login_confirmation_requested",
        severity="info",
        message=f"Confirmation de connexion demandée pour {current_user.email}.",
        user_id=current_user.id,
        payload={"email": current_user.email},
        monitoring_hub=request.app.state.monitoring_hub,
    )
    await session.commit()
    return {
        "status": "accepted",
        "message": "Confirmation enregistrée. Configurez SMTP pour envoi réel.",
    }
PYEOF
  warn "Vérifiez auth_routes.py : imports get_current_user déjà présents."
fi

# --- 8. Telegram — personnaliser l'URL du canal ---
read -r -p "URL canal Telegram (Entrée = https://t.me/sentiq_actus) : " TG_URL || true
TG_URL=${TG_URL:-https://t.me/sentiq_actus}
sed -i "s|https://t.me/sentiq_actus|${TG_URL}|g" "$UI_TARGET" 2>/dev/null || true
info "Telegram : $TG_URL"

# --- 9. Redémarrage service ---
restart_ok=false
if command -v docker >/dev/null 2>&1; then
  CONTAINER=$(docker ps --format '{{.Names}}' | grep -iE 'trading|sentiq|backend|api' | head -1 || true)
  if [[ -n "$CONTAINER" ]]; then
    docker restart "$CONTAINER"
    info "Docker redémarré : $CONTAINER"
    restart_ok=true
  fi
fi

if [[ "$restart_ok" == false ]]; then
  for svc in trading-backend trading sentiq uvicorn; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      systemctl restart "$svc"
      info "Service redémarré : $svc"
      restart_ok=true
      break
    fi
  done
fi

if [[ "$restart_ok" == false ]]; then
  warn "Redémarrage manuel requis. Exemples :"
  echo "  docker restart \$(docker ps -q)"
  echo "  systemctl restart nginx"
fi

# --- 10. Test ---
sleep 2
if curl -sf -o /dev/null "http://127.0.0.1:8000/ui" 2>/dev/null || curl -sf -o /dev/null "http://127.0.0.1/ui" 2>/dev/null; then
  info "✅ UI accessible localement"
else
  warn "Test local /ui non concluant — vérifiez nginx et le port API"
fi

echo ""
info "=========================================="
info " Déploiement terminé"
info " URL : https://trading.agent-leads.fr/ui"
info "=========================================="
echo ""
echo "Récap des changements :"
echo "  ✅ Bouton + → modal dépôt"
echo "  ✅ Questionnaire 1ère connexion (prénom, nom, âge, objectif)"
echo "  ✅ Bonjour personnalisé"
echo "  ✅ Login classique + placeholders Google/Apple"
echo "  ✅ Lien Telegram lecture seule"
echo "  ✅ Suppression libellés « connecté »"
echo "  ✅ Seuil probabilité ajustable + enregistrement API"
echo ""
echo "« En attente de configuration » signifiait :"
echo "  le seuil n'était pas encore chargé depuis l'API."
echo "  → Remplacé par un slider + bouton Enregistrer."
