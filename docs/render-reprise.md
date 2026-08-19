# Reprendre Render (service suspendu)

Le message **« This service has been suspended by its owner »** signifie que le service a été **mis en pause dans Render** (pas un bug du code).

## Reprise en 1 clic (2 minutes)

1. Allez sur https://dashboard.render.com
2. Ouvrez le service **clipforge-studio**
3. Cliquez **Resume service** (Reprendre)
4. Attendez la fin du déploiement (2–5 min)

**Lien prospection :** https://clipforge-studio.onrender.com/prospection

## Si le déploiement échoue après reprise

Le Dockerfile a été corrigé pour la nouvelle structure (`agent-prospection/`, `clipforge/`, etc.). Fusionnez la PR #31 sur `main`, puis **Manual Deploy** dans Render.

## Automatiser (optionnel)

Dans GitHub → Settings → Secrets, ajoutez :

| Secret | Usage |
|--------|--------|
| `RENDER_API_KEY` | Clé API Render (Settings → API Keys) |
| `RENDER_SERVICE_ID` | ID du service (srv-…) |
| `RENDER_DEPLOY_HOOK` | URL Deploy Hook du service |
| `RENDER_URL` | `https://clipforge-studio.onrender.com` |

Le workflow `.github/workflows/render-prospection.yml` reprendra et vérifiera le service à chaque push sur `main`.

## Service léger (backup)

`render.yaml` définit aussi **agent-prospection** (Docker minimal, prospection seule) :

https://agent-prospection.onrender.com/prospection

Créez-le via **New → Blueprint** dans Render si besoin.
