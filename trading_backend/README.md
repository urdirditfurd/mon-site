# Backend Trading IA (FastAPI)

Backend Python modulaire pour:

- gestion utilisateur + portefeuille interne
- dépôt simulé (style Stripe)
- allocation du capital vers le robot de trading
- simulation de flux d'actualités financières en continu

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
  Crée un utilisateur avec son wallet initial.
- `POST /api/wallets/{user_id}/deposit`  
  Simule un paiement Stripe et crédite `solde_total` + `solde_disponible`.
- `POST /api/wallets/{user_id}/allocate`  
  Déplace un montant de `solde_disponible` vers `solde_engage`.
- `GET /api/news/live?limit=10`  
  Retourne les dernières actualités simulées (générées toutes les 5 secondes).
- `GET /api/health`  
  Vérification de l'état de l'API.
