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

## Variables d'environnement

```bash
export DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5432/trading_ai"
export DEBUG="true"
export AUTH_SECRET_KEY="change-me-in-production"
export AUTH_TOKEN_EXPIRY_MINUTES="120"
```

## Lancer l'API

```bash
uvicorn app.main:app --reload --port 8000
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

## Note migration locale

Le projet utilise actuellement `create_all` (sans Alembic).  
Si tu as déjà créé les tables avec un ancien schéma, supprime/recrée la base locale avant de redémarrer l'API pour prendre en compte les nouveaux champs broker/PnL/risk/auth.
