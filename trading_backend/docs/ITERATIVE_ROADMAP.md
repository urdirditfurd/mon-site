# Roadmap itérative — Trading IA sentiment

Développement par phases testables (sans dispersion sur l'ensemble de la spec).

## Phase 1 — Coeur algorithmique (livré)

- PostgreSQL : `user_preferences`, `market_signals`, `active_trades`
- `analyze_incoming_news()` : NLP simulé, secteur, probabilités, TTL, seuil 70 %
- `evaluate_trading_opportunity()` : préférences × signaux → `active_trades`

## Phase 2 — Ingestion temps réel

- WebSockets Bloomberg / Reuters / Benzinga, X API v2, RSS

## Phase 3 — NLP production

- FinBERT ou Llama quantifié à la place du mock

## Phase 4 — Dashboard sombre

- Capital, seuil %, filtres sectoriels, notifications fin de cycle

## Phase 5 — Brokers

- Alpaca, IBKR, Binance, Coinbase Advanced Trade

## Phase 6 — Clôture autonome

- Essoufflement sentiment, solde position, relance capital
