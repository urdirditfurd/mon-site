# Backend Trading IA (FastAPI)

Backend Python modulaire pour:

- gestion utilisateur + portefeuille interne
- dépôt simulé (style Stripe)
- allocation du capital vers le robot de trading
- simulation de flux d'actualités financières en continu
- moteur NLP mock (direction + confiance)
- déclenchement d'ordres simulés selon seuil utilisateur
- passerelle broker mock (statuts pending/filled/rejected)
- calcul de PnL simulé par ordre exécuté
- gestion du risque (kill switch, stop-loss, max drawdown, limite d'ordres/jour)
- audit trail persistant (journal d'événements système)
- centre d'alertes opérationnelles (open/ack)
- monitoring dashboard + websocket temps réel
- contrôle global du moteur (pause/reprise runtime)
- reporting & conformité (historique filtré, rapports journaliers, export fiscal)
- authentification Bearer + RBAC (`trader`, `compliance`, `admin`)

## Installation

```bash
cd trading_backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Demarrage ultra simple

### Option 0 - Bootstrap complet (recommande)

Tu lances une seule commande, le script fait:
- installation des dependances,
- verifications,
- migrations DB,
- demarrage API.

PowerShell Windows:
```powershell
cd .\trading_backend
.\scripts\bootstrap.ps1
```

Linux / macOS:
```bash
cd trading_backend
./scripts/bootstrap.sh
```

### Option 0-bis - Mode non-stop auto au demarrage Windows

Ouvre PowerShell **en administrateur** puis:

```powershell
cd .\trading_backend
.\scripts\install-autostart.ps1 -DatabaseUrl 'postgresql+asyncpg://postgres:PgStrong!2026@localhost:5432/trading_ai'
```

Ce mode:
- demarre automatiquement au boot Windows,
- relance l'API si elle s'arrete,
- applique les migrations au redemarrage.

Pour desinstaller:
```powershell
.\scripts\uninstall-autostart.ps1
```

### Option 0-ter - Etape zero-tech (compte admin + wallet preconfigure)

Une seule commande pour creer (ou mettre a jour) un compte admin de demo et le wallet:

```powershell
cd .\trading_backend
.\scripts\zero-tech-setup.ps1 -DatabaseUrl 'postgresql+asyncpg://postgres:PgStrong!2026@localhost:5432/trading_ai'
```

Le script initialise les donnees et verifie si l'API repond.  
S'il indique que l'API n'est pas demarree, lance:
```powershell
.\scripts\run-local.ps1 -DatabaseUrl 'postgresql+asyncpg://postgres:PgStrong!2026@localhost:5432/trading_ai'
```

### Option 0-quater - Test automatique OK/KO (health + login + wallet)

Une seule commande pour verifier rapidement que l'application fonctionne:

```powershell
cd .\trading_backend
.\scripts\zero-tech-smoke.ps1
```

Avec options:
```powershell
.\scripts\zero-tech-smoke.ps1 `
  -BaseUrl 'http://127.0.0.1:8000' `
  -Email 'admin@trading-ia.com' `
  -Password 'Admin!ChangeMe2026' `
  -DepositAmount '50.00' `
  -AllocateAmount '25.00'
```

### Option 0-quinquies - Mini interface web zero-tech

Une fois l'API demarree, ouvre simplement:

`http://127.0.0.1:8000/ui`

Tu as:
- login,
- dashboard wallet/trading,
- boutons depot + allocation,
- flux monitoring live websocket.

Par defaut, le script configure:
- email: `admin@trading-ia.com`
- password: `Admin!ChangeMe2026`
- wallet total: `10000.00`
- wallet engage (trading): `2500.00`
- seuil IA: `75.00`

Tu peux personnaliser:
```powershell
.\scripts\zero-tech-setup.ps1 `
  -DatabaseUrl 'postgresql+asyncpg://postgres:PgStrong!2026@localhost:5432/trading_ai' `
  -Email 'admin@tondomaine.com' `
  -Password 'TaCleForteIci' `
  -SeedTotal '15000.00' `
  -SeedEngaged '5000.00' `
  -Threshold '72.50'
```

### Option A - Local (PowerShell Windows)

```powershell
cd .\trading_backend
.\scripts\run-local.ps1
```

Le script:
- applique les migrations Alembic,
- puis lance l'API automatiquement.

### Option B - Docker (recommande pour "toujours allume")

```powershell
cd .\trading_backend
.\scripts\run-docker.ps1
```

Pour reconstruire les images:
```powershell
.\scripts\run-docker.ps1 -Build
```

## Variables d'environnement

```bash
export DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai"
export DEBUG="true"
export AUTH_SECRET_KEY="change-me-in-production"
export AUTH_TOKEN_EXPIRY_MINUTES="120"
export AUTO_CREATE_TABLES="false"
export NEWS_INTERVAL_SECONDS="5"
export RUNTIME_RECOVERY_DELAY_SECONDS="2"
export WATCHDOG_INTERVAL_SECONDS="10"
export LOG_LEVEL="INFO"
export LOG_FILE_PATH="storage/logs/trading-backend.log"
```

## Lancer l'API

```bash
uvicorn app.main:app --reload --port 8000
```

## Migrations base de données (Alembic)

```bash
# depuis trading_backend/
alembic upgrade head
```

Créer une nouvelle migration:
```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
```

Revenir d'une migration:
```bash
alembic downgrade -1
```

Workflow standardisé (recommandé):
```bash
make migrate-check-strict
make migrate-release-dry
make migrate-release
make migrate-rollback-dry TARGET=-1
make migrate-rollback TARGET=-1
```

Pré-commit (qualité migrations):
```bash
pre-commit install
pre-commit run --all-files
```

## Endpoints principaux

- `POST /api/users`  
  Crée un utilisateur (inscription) avec wallet initial + seuil IA par défaut à `80%`.
- `POST /api/auth/login`  
  Authentifie l'utilisateur et renvoie un token Bearer.
- `GET /api/auth/me`  
  Retourne l'identité de l'utilisateur connecté.
- `POST /api/wallets/{user_id}/deposit`  
  Simule un paiement Stripe et crédite `solde_total` + `solde_disponible`.
- `POST /api/wallets/{user_id}/allocate`  
  Déplace un montant de `solde_disponible` vers `solde_engage`.
- `PATCH /api/trading/users/{user_id}/threshold`  
  Met à jour le seuil de probabilité minimum (0 à 100) requis pour déclencher un trade IA.
- `GET /api/trading/users/{user_id}/risk`  
  Retourne l'état courant de gestion du risque (drawdown, compteurs journaliers, kill switch).
- `PATCH /api/trading/users/{user_id}/risk`  
  Met à jour la politique de risque (kill switch, stop-loss, max drawdown, limite d'ordres/jour).
- `GET /api/trading/users/{user_id}/orders?limit=20`  
  Retourne l'historique des ordres simulés déclenchés par la stratégie (avec statut broker et PnL).
- `GET /api/trading/users/{user_id}/orders/stats`  
  Retourne les statistiques d'exécution (`pending`, `filled`, `rejected`, PnL total).
- `GET /api/trading/engine/control`  
  Retourne l'état global du moteur (running/paused).
- `PATCH /api/trading/engine/pause`  
  Met le moteur en pause globale.
- `PATCH /api/trading/engine/resume`  
  Relance le moteur global.
- `GET /api/monitoring/audit`  
  Liste les événements d'audit (filtres: user, severity, event_type).
- `GET /api/monitoring/alerts`  
  Liste les alertes (open/ack).
- `PATCH /api/monitoring/alerts/{alert_id}/ack`  
  Acquitte une alerte.
- `GET /api/monitoring/dashboard`  
  Snapshot global d'exploitation (users/orders/PnL/alerts + derniers événements runtime).
- `WS /api/monitoring/ws`  
  Flux temps réel des événements monitoring (token requis via query `?token=...`).
- `GET /api/reporting/users/{user_id}/history`  
  Historique filtrable des ordres (`start_date`, `end_date`, `asset_symbol`, `status`).
- `GET /api/reporting/users/{user_id}/summary`  
  Résumé trading sur période (volume, PnL, win rate, etc.).
- `GET /api/reporting/users/{user_id}/compliance`  
  Résumé conformité sur période (audit events + alertes).
- `GET /api/reporting/users/{user_id}/daily-report.json`  
  Rapport journalier structuré JSON.
- `GET /api/reporting/users/{user_id}/daily-report.pdf`  
  Rapport journalier PDF (téléchargement).
- `GET /api/reporting/users/{user_id}/tax-export?year=YYYY`  
  Export fiscal simplifié annuel (PnL global + breakdown par actif).
- `GET /api/news/live?limit=10`  
  Retourne les dernières actualités simulées et scorées par le NLP mock (toutes les 5 secondes).
- `GET /api/health`  
  Vérification de l'état de l'API.
- `GET /api/health/live`  
  Vérifie que le process API est vivant.
- `GET /api/health/ready`  
  Vérifie que la DB + moteur + simulateur sont prêts.
- `GET /ui`  
  Interface web zero-tech embarquee (login + dashboard + wallet + live monitoring).
- `POST /api/decision/signals/analyze`  
  Lance l'analyse NLP simulée d'une news, persiste un `market_signal` et retourne score/TTL.
- `POST /api/decision/users/{user_id}/evaluate`  
  Évalue les signaux valides récents selon les préférences utilisateur et crée une opportunité `active_trade` si éligible.

## Coeur algorithmique (mission IA data-driven)

Le backend inclut maintenant un moteur dédié dans `app/services/decision_engine.py`:

- `analyze_incoming_news(news_text, category)`  
  Analyse NLP simulée, mapping sectoriel, calcul de probabilités haussier/baissier, TTL dynamique, persistance en `market_signals`.
- `evaluate_trading_opportunity(user_id)`  
  Croise les préférences utilisateur et les signaux valides récents, puis ouvre une opportunité en `active_trades` si les conditions sont réunies.

Nouvelles tables PostgreSQL:
- `user_preferences` (filtres classes d'actifs + secteurs + seuil min),
- `market_signals` (news scorées avec métadonnées NLP/TTL),
- `active_trades` (positions ouvertes avec horizon temporel théorique).

Exemple d'appel:
```json
POST /api/decision/signals/analyze
{
  "news_text": "Gold and lithium miners rally after supply shock in Asia",
  "category": "reuters/stocks"
}
```

## Logique Brique C (résumé)

1. Le simulateur génère une nouvelle actu financière toutes les 5 secondes.
2. Le moteur NLP mock attribue :
   - une direction (`buy` / `sell`)
   - une confiance (`0-100`)
3. Le moteur de trading compare cette confiance au `seuil_probabilite_min` de chaque utilisateur.
4. Si la confiance est suffisante et que `solde_engage > 0`, un ordre est soumis au broker mock.
5. Le broker mock renvoie un statut initial (`pending`, `filled` ou `rejected`).
6. Les ordres `pending` sont finalisés en asynchrone avec un résultat `filled/rejected`.
7. Les ordres `filled` reçoivent un `pnl_simule` calculé automatiquement.

## Logique Brique E (gestion du risque)

Les contrôles suivants sont appliqués avant chaque ordre:

1. **Kill switch utilisateur**: si actif, aucun ordre n'est soumis.
2. **Limite d'ordres par jour**: blocage dès que la limite configurée est atteinte.
3. **Max drawdown**: si le drawdown courant dépasse la limite, le trading est auto-pausé.

Sur les ordres exécutés:

4. **Stop-loss par ordre**: la perte max est cappée au pourcentage configuré.
5. **Mise à jour equity/PnL**: `solde_engage`, `solde_total`, equity et PnL journalier sont recalculés.
6. **Auto-pause sécurité**: si capital engagé épuisé ou drawdown limite atteint, le trading passe en pause.

## Brique F — Audit & Monitoring

- Chaque action clé (création user, dépôt, allocation, update risque, soumission/finalisation ordre, pause/reprise moteur) est tracée dans `audit_events`.
- Les situations critiques génèrent des alertes persistées dans `alert_events`.
- Les événements runtime sont aussi diffusés en mémoire via `MonitoringHub` pour le dashboard live.

## Briques suivantes implémentées

### G — Alerting opérationnel
- Alertes dédupliquées pour les cas de risque/broker (`ensure_open_alert`).
- Acquittement manuel via API.

### H — Dashboard temps réel
- Endpoint agrégé `GET /api/monitoring/dashboard`.
- WebSocket `/api/monitoring/ws` (events + heartbeat).

### I — Pilotage global moteur
- Pause/reprise du moteur via API sans redémarrage backend.
- Le moteur ignore les signaux entrants pendant une pause globale.

## Brique J — Reporting & conformité

- **Historique filtrable** par période/utilisateur/actif/statut.
- **Résumé de performance** sur période (volume, PnL, win rate, confiance moyenne).
- **Rapport journalier** exportable en JSON et PDF.
- **Export fiscal simplifié annuel** avec:
  - résultat imposable,
  - pertes déductibles,
  - détail par actif (trades, volume, gains/pertes).
- Génération des exports tracée dans l'audit trail.

## Brique K — Authentification & permissions (RBAC)

- Auth Bearer token signé (HMAC SHA-256) avec expiration configurable.
- Hash des mots de passe via `PBKDF2-SHA256`.
- Rôles supportés:
  - `trader`
  - `compliance`
  - `admin`
- Règles principales:
  - accès **self** autorisé sur ses données personnelles,
  - accès transversal réservé à `admin/compliance`,
  - monitoring dashboard + alert center réservés à `admin/compliance`,
  - pause/reprise moteur réservés à `admin`.

### Utilisation rapide auth

1. Créer un utilisateur:
```json
POST /api/users
{
  "email": "alice@example.com",
  "password": "SuperSecret123",
  "role": "trader"
}
```

2. Login:
```json
POST /api/auth/login
{
  "email": "alice@example.com",
  "password": "SuperSecret123"
}
```

3. Ajouter le header:
```bash
Authorization: Bearer <token>
```

## Brique L — Workflow migrations incrémentales (dev/prod)

- Ajout d'un workflow outillé: `scripts/migration_workflow.py`
  - `check` (cohérence graphe migrations + compile check)
  - `release` (pipeline release migration)
  - `rollback` (downgrade contrôlé)
- Ajout d'une config `.pre-commit-config.yaml` pour empêcher les migrations invalides avant commit.
- Ajout d'un `Makefile` pour standardiser les commandes de l'équipe.
- Runbook complet:
  - `docs/migration-runbook.md`

## Mode operationnel continu

- Boucles runtime auto-recover (simulateur news + moteur trading)
- Watchdog qui relance automatiquement les composants internes si besoin
- Endpoint readiness avec statut detaille
- Logs persistants dans `storage/logs/trading-backend.log`
- Superviseur Windows avec logs dans `storage/logs/supervisor.log`
- Docker Compose avec:
  - restart `unless-stopped`
  - healthchecks DB + API
  - auto migration au demarrage container

## Note migration locale

Le projet utilise actuellement `create_all` (sans Alembic).  
Le projet inclut maintenant Alembic (`alembic/` + migration initiale).  
Si tu as déjà une base locale existante créée sans Alembic, deux options:

1) **Repartir proprement**: supprimer/recréer la base puis `alembic upgrade head`.
2) **Conserver les données**: aligner Alembic avec `alembic stamp head` (si le schéma DB est déjà identique).

## Tests automatisés du moteur de décision

Le cœur algorithmique (`app/services/decision_engine.py`) est couvert par
une suite **pytest asynchrone** située dans `trading_backend/tests/`. Elle
valide les trois livrables de la mission 1 sans dépendre d'un serveur
PostgreSQL : un SQLite asynchrone éphémère est monté à la volée et le
metadata SQLAlchemy y crée le schéma complet (`users`, `wallets`,
`user_preferences`, `market_signals`, `active_trades`).

Lancement :

```bash
cd trading_backend
pip install -r requirements-dev.txt   # ou: make test-install
make test                             # ou: pytest
```

Couverture :

- **`analyze_incoming_news`** — scoring polarité haussier/baissier,
  mapping sectoriel par frontière de mot (corrige le faux positif
  historique où "major" matchait le ticker "or" des Mines), validation
  stricte du seuil 70 %, TTL dynamique (macro vs tweet d'influenceur),
  persistance du signal et déterminisme entrée → sortie.
- **`evaluate_trading_opportunity`** — choix du signal le plus fort,
  bascule `buy`/`sell` selon polarité, application stricte du seuil
  utilisateur, filtrage par secteur et par classe d'actif, idempotence
  (pas de double position sur le même signal), garde-fous wallet
  (utilisateur inactif, capital nul, préférences manquantes).
