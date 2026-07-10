# AutoTrading Lemon 🍋

Plateforme d'analyse et de trading automatique pour débutants — inspirée OpenAlice (Trading-as-Git, heartbeat 24/7).

**Code GitHub :** https://github.com/urdirditfurd/mon-site/tree/cursor/autotrading-lemon-7205/autotrading

## Fonctionnalités

| Fonctionnalité | Statut |
|----------------|--------|
| Données marché réelles (actions, ETF, crypto) | ✅ yfinance + CoinGecko |
| Scoring bayésien (RSI, MACD, Bollinger, EMA) | ✅ |
| Top opportunités + suivi positions | ✅ |
| Alertes vente + Telegram | ✅ |
| **Connexion courtiers multi-exchange (CCXT)** | ✅ |
| **Trading-as-Git (stage → approve → execute)** | ✅ |
| Heartbeat 24/7 | ✅ |

## Courtiers supportés

| Exchange | France | Usage |
|----------|--------|-------|
| **Kraken** ★ | Recommandé (PSAN AMF) | Crypto réel |
| **Bitget** | Alternative EU | Crypto paper/live |
| **OKX / Bybit** | Vérifier pays | Crypto |
| **Binance** | ⚠️ Fermeture FR | Testnet uniquement |
| **Alpaca** | Paper actions US | Actions/ETF |

> **Binance ferme en France.** Utilisez Kraken ou Bitget pour le trading réel. Commencez toujours en mode **paper/testnet**.

## Déploiement VPS

```bash
cd autotrading
cp .env.example .env
docker compose up -d --build
```

### Variables importantes (.env)

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
API_SECRET_KEY=cle-secrete-longue
ALLOW_LIVE_TRADING=false    # true uniquement quand vous êtes prêt
MAX_ORDER_USD=500
DEFAULT_BROKER_MODE=paper
AUTO_STAGE_ON_SIGNAL=false  # true = prépare ordres auto sur signaux
```

## Flux trading automatique

```
Scan marché → Signal ACHETER/VENDRE
       ↓
Stage ordre (en attente)
       ↓
Vous approuvez dans l'UI (ou Telegram)
       ↓
Exécution chez Kraken/Bitget/Alpaca...
```

## API broker

| Endpoint | Description |
|----------|-------------|
| `GET /api/broker/exchanges` | Liste des courtiers |
| `POST /api/broker/connect` | Connecter un courtier |
| `POST /api/broker/orders/stage` | Préparer un ordre |
| `POST /api/broker/orders/{id}/approve` | Approuver & exécuter |
| `POST /api/broker/orders/{id}/reject` | Rejeter |

## Avertissement légal

Outil éducatif — pas un conseil en investissement. Le trading comporte un risque de perte totale du capital.
