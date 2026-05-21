# Déploiement production sur VPS OVH

Cette procédure met en ligne le backend Trading IA sur un VPS OVH avec:

- FastAPI + Uvicorn
- PostgreSQL 16 persistant
- migrations Alembic automatiques au démarrage
- Caddy en reverse proxy HTTPS automatique

## Architecture recommandée

GitHub reste la source de code privée. Le VPS OVH exécute l'application via Docker Compose:

```text
Internet HTTPS -> Caddy :443 -> API FastAPI :8000 -> PostgreSQL privé
```

## Prérequis OVH

1. VPS Ubuntu 22.04/24.04.
2. Un nom de domaine ou sous-domaine pointant vers l'IP publique du VPS.
   - Exemple: `trading.tondomaine.com` avec un enregistrement DNS `A`.
3. Ports ouverts côté pare-feu:
   - `22/tcp` pour SSH
   - `80/tcp` pour validation Let's Encrypt
   - `443/tcp` pour HTTPS

## Déploiement rapide recommandé

Une fois connecté au VPS, tu peux utiliser les scripts fournis:

```bash
git clone https://github.com/urdirditfurd/mon-site.git
cd mon-site/trading_backend
sudo bash deploy/ovh/bootstrap-server.sh
```

Déconnecte-toi puis reconnecte-toi en SSH pour activer le groupe Docker, ensuite:

```bash
cd mon-site/trading_backend
bash deploy/ovh/deploy-production.sh
```

Le premier lancement crée `.env.production`, s'arrête, et te demande de remplacer les secrets + le domaine. Après modification:

```bash
bash deploy/ovh/deploy-production.sh
```

## Checklist DNS OVH

Dans le Manager OVH:

1. Ouvre **Web Cloud** > **Noms de domaine**.
2. Sélectionne ton domaine.
3. Va dans **Zone DNS**.
4. Ajoute ou modifie un enregistrement:
   - type: `A`
   - sous-domaine: par exemple `trading`
   - cible: IP publique du VPS
5. Attends la propagation DNS.

Vérification depuis ton ordinateur:

```bash
dig +short trading.tondomaine.com
```

Le résultat doit être l'IP publique du VPS.

## 1. Préparer le serveur

Connecte-toi en SSH:

```bash
ssh ubuntu@IP_DU_VPS
```

Installe Docker:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Reconnecte-toi ensuite en SSH pour activer le groupe `docker`.

## 2. Récupérer le code depuis GitHub

```bash
git clone https://github.com/urdirditfurd/mon-site.git
cd mon-site/trading_backend
```

Si le dépôt devient privé, utilise une clé SSH GitHub ou un token de déploiement.

## 3. Configurer l'environnement production

```bash
cp .env.production.example .env.production
nano .env.production
```

À remplacer impérativement:

- `POSTGRES_PASSWORD`
- `AUTH_SECRET_KEY`
- `DOMAIN`
- `ACME_EMAIL`

Générer des secrets:

```bash
openssl rand -hex 32
```

## 4. Démarrer l'application

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Vérifier l'état:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
```

Tester:

```bash
curl https://TON_DOMAINE/api/health
curl https://TON_DOMAINE/api/health/ready
```

L'interface embarquée est disponible sur:

```text
https://TON_DOMAINE/ui
```

## 5. Mettre à jour après un nouveau push GitHub

```bash
cd ~/mon-site/trading_backend
git pull origin main
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

## 6. Sauvegarde PostgreSQL

Créer un dump:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > trading_ai_backup.sql
```

Restaurer un dump:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" "$POSTGRES_DB" < trading_ai_backup.sql
```

## Notes sécurité avant commercialisation

- Garde le dépôt GitHub privé.
- Ne commit jamais `.env.production`.
- Utilise un domaine HTTPS stable.
- Ajoute une stratégie de sauvegarde automatique PostgreSQL.
- Ajoute plus tard un vrai provider de secrets et une supervision externe.
- Les connecteurs broker réels doivent passer par des clés API restreintes et chiffrées.
