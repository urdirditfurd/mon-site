# AutoTrading Lemon 🍋

**Plateforme d'analyse et de recommandations trading pour débutants** — inspirée des principes OpenAlice (surveillance 24/7, mémoire, notifications), adaptée à un VPS sans budget.

## Phase Lemon (MVP actuel)

| Fonctionnalité | Statut |
|----------------|--------|
| Données marché réelles (actions, ETF, BTC/ETH) | ✅ yfinance + CoinGecko |
| Analyse technique + probabilité achat/vente | ✅ RSI, SMA, MACD, momentum |
| Top opportunités classées pour débutants | ✅ |
| Suivi de positions papier | ✅ |
| Alertes vente (take-profit, stop-loss, signal) | ✅ |
| Notifications Telegram (gratuit) | ✅ optionnel |
| Heartbeat / watchdog 24/7 | ✅ |
| Interface web débutant | ✅ |
| Exécution broker réelle | ❌ phase suivante |

## Démarrage rapide (VPS)

### Docker (recommandé)

```bash
cd autotrading
cp .env.example .env
# Éditer .env : ajouter TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID pour les alertes
docker compose up -d --build
```

Ouvrir : `http://VOTRE_IP:8100`

### Sans Docker

```bash
cd autotrading
chmod +x scripts/run-local.sh
./scripts/run-local.sh
```

## Notifications Telegram (gratuit)

1. Ouvrir Telegram → chercher **@BotFather** → `/newbot`
2. Copier le token dans `TELEGRAM_BOT_TOKEN`
3. Envoyer un message à votre bot, puis récupérer votre `chat_id` via :
   `https://api.telegram.org/bot<VOTRE_TOKEN>/getUpdates`
4. Coller le `chat_id` dans `TELEGRAM_CHAT_ID`

## Architecture

```
autotrading/
├── app/
│   ├── main.py              # FastAPI + scheduler
│   ├── api/routes.py        # REST + WebSocket
│   ├── services/
│   │   ├── market_data.py   # Cours réels (gratuit)
│   │   ├── analyzer.py      # Probabilités
│   │   ├── recommender.py   # Top opportunités
│   │   ├── position_monitor.py  # Alertes vente
│   │   ├── notifier.py      # Telegram / email
│   │   └── scanner.py       # Heartbeat 24/7
│   └── web/                 # Interface débutant
├── docker-compose.yml
└── .env.example
```

## API principale

| Endpoint | Description |
|----------|-------------|
| `GET /` | Interface web |
| `GET /api/dashboard` | Vue complète |
| `GET /api/recommendations` | Top opportunités |
| `POST /api/scan/trigger` | Forcer un scan |
| `GET /api/analyze/{symbol}` | Analyse d'un actif |
| `POST /api/positions` | Suivre un trade (papier) |
| `GET /api/positions` | Positions ouvertes |
| `WS /api/ws` | Flux temps réel |

## Roadmap (après Lemon)

1. **Phase Citron** — LLM (Mistral/Ollama) pour explications en langage naturel
2. **Phase Orange** — Plus d'actifs, sentiment news RSS, Fear & Greed
3. **Phase Pamplemousse** — Connexion broker (paper trading IBKR/CCXT)
4. **Phase OpenAlice** — Flux stage/commit/push avec approbation humaine

## Avertissement légal

Cet outil est **éducatif**. Les probabilités sont des estimations techniques, pas des conseils en investissement. Ne tradez que ce que vous pouvez perdre.
