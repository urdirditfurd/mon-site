# Backend Trading IA (FastAPI)

Backend Python modulaire pour:

- gestion utilisateur + portefeuille interne
- dépôt simulé (style Stripe)
- allocation du capital vers le robot de trading
- simulation de flux d'actualités financières en continu
- moteur NLP mock (direction + confiance)
- déclenchement d'ordres simulés selon seuil utilisateur

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
```

## Lancer l'API

```bash
uvicorn app.main:app --reload --port 8000
```

## Endpoints principaux

- `POST /api/users`  
  Crée un utilisateur avec son wallet initial + seuil IA par défaut à `80%`.
- `POST /api/wallets/{user_id}/deposit`  
  Simule un paiement Stripe et crédite `solde_total` + `solde_disponible`.
- `POST /api/wallets/{user_id}/allocate`  
  Déplace un montant de `solde_disponible` vers `solde_engage`.
- `PATCH /api/trading/users/{user_id}/threshold`  
  Met à jour le seuil de probabilité minimum (0 à 100) requis pour déclencher un trade IA.
- `GET /api/trading/users/{user_id}/orders?limit=20`  
  Retourne l'historique des ordres simulés déclenchés par la stratégie.
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
4. Si la confiance est suffisante et que `solde_engage > 0`, un ordre simulé est créé dans `simulated_orders`.
