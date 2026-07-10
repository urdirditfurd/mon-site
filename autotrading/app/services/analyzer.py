"""Analyse technique + score de probabilité achat/vente (MVP lemon)."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

from app.schemas.market import AnalysisResult
from app.services.market_data import MarketSnapshot


@dataclass(slots=True)
class IndicatorSet:
    rsi: float
    sma_20: float
    sma_50: float
    macd: float
    macd_signal: float
    volume_ratio: float
    momentum_5d: float
    momentum_20d: float


def _sma(values: list[float], period: int) -> float:
    if len(values) < period:
        return mean(values) if values else 0.0
    return mean(values[-period:])


def _ema(values: list[float], period: int) -> float:
    if not values:
        return 0.0
    k = 2 / (period + 1)
    ema_val = values[0]
    for v in values[1:]:
        ema_val = v * k + ema_val * (1 - k)
    return ema_val


def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0))
        losses.append(max(-delta, 0))
    avg_gain = mean(gains[-period:])
    avg_loss = mean(losses[-period:])
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _macd(closes: list[float]) -> tuple[float, float]:
    if len(closes) < 26:
        return 0.0, 0.0
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    macd_line = ema12 - ema26
    macd_history = []
    for i in range(26, len(closes) + 1):
        slice_closes = closes[:i]
        m = _ema(slice_closes, 12) - _ema(slice_closes, 26)
        macd_history.append(m)
    signal = _ema(macd_history, 9) if macd_history else 0.0
    return macd_line, signal


def compute_indicators(snapshot: MarketSnapshot) -> IndicatorSet:
    closes = [b.close for b in snapshot.bars]
    volumes = [b.volume for b in snapshot.bars]
    rsi = _rsi(closes)
    sma_20 = _sma(closes, 20)
    sma_50 = _sma(closes, 50)
    macd, macd_signal = _macd(closes)
    avg_vol = mean(volumes[-20:]) if len(volumes) >= 20 else (mean(volumes) if volumes else 1)
    vol_ratio = (volumes[-1] / avg_vol) if avg_vol else 1.0
    mom_5 = ((closes[-1] - closes[-6]) / closes[-6] * 100) if len(closes) >= 6 else 0.0
    mom_20 = ((closes[-1] - closes[-21]) / closes[-21] * 100) if len(closes) >= 21 else 0.0
    return IndicatorSet(
        rsi=rsi,
        sma_20=sma_20,
        sma_50=sma_50,
        macd=macd,
        macd_signal=macd_signal,
        volume_ratio=vol_ratio,
        momentum_5d=mom_5,
        momentum_20d=mom_20,
    )


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def analyze_snapshot(snapshot: MarketSnapshot) -> AnalysisResult:
    """Transforme indicateurs techniques en probabilités compréhensibles pour débutants."""

    ind = compute_indicators(snapshot)
    price = snapshot.price

    # Score achat (0-100) — pondération simple, explicable
    buy_score = 50.0

    # RSI : zone 40-60 neutre, <35 survente (bullish), >70 surachat (bearish)
    if ind.rsi < 35:
        buy_score += 15
    elif ind.rsi < 45:
        buy_score += 8
    elif ind.rsi > 70:
        buy_score -= 18
    elif ind.rsi > 60:
        buy_score -= 8

    # Golden / death cross simplifié
    if ind.sma_20 > ind.sma_50:
        buy_score += 12
    else:
        buy_score -= 10

    # MACD
    if ind.macd > ind.macd_signal:
        buy_score += 10
    else:
        buy_score -= 8

    # Momentum
    buy_score += _clamp(ind.momentum_5d * 1.5, -12, 12)
    buy_score += _clamp(ind.momentum_20d * 0.8, -10, 10)

    # Volume confirme le mouvement
    if ind.volume_ratio > 1.3 and snapshot.change_pct_24h > 0:
        buy_score += 6
    elif ind.volume_ratio > 1.3 and snapshot.change_pct_24h < 0:
        buy_score -= 6

    # Crypto : volatilité plus forte → prudence
    if snapshot.asset_type == "crypto":
        buy_score -= 5

    buy_probability = _clamp(buy_score)
    sell_probability = _clamp(100 - buy_score + (ind.rsi - 50) * 0.3)

    if buy_probability >= 65 and ind.rsi < 72:
        signal = "ACHETER"
    elif sell_probability >= 60 or ind.rsi > 75:
        signal = "VENDRE"
    else:
        signal = "ATTENDRE"

    confidence = _clamp(abs(buy_probability - 50) * 1.6 + abs(ind.momentum_5d))

    reasoning_parts = [
        f"Prix actuel : {price:.2f} {snapshot.currency} ({snapshot.change_pct_24h:+.1f}% sur 24h).",
        f"RSI à {ind.rsi:.0f} — {'zone de survente' if ind.rsi < 35 else 'surachat possible' if ind.rsi > 70 else 'zone neutre'}.",
        f"Moyennes mobiles : tendance {'haussière' if ind.sma_20 > ind.sma_50 else 'baissière'}.",
        f"MACD {'positif' if ind.macd > ind.macd_signal else 'négatif'}.",
        f"Momentum 5j : {ind.momentum_5d:+.1f}%.",
    ]

    return AnalysisResult(
        symbol=snapshot.symbol,
        asset_type=snapshot.asset_type,
        buy_probability=round(buy_probability, 1),
        sell_probability=round(sell_probability, 1),
        signal=signal,
        confidence=round(confidence, 1),
        reasoning=" ".join(reasoning_parts),
        indicators={
            "rsi": round(ind.rsi, 2),
            "sma_20": round(ind.sma_20, 2),
            "sma_50": round(ind.sma_50, 2),
            "macd": round(ind.macd, 4),
            "momentum_5d": round(ind.momentum_5d, 2),
            "volume_ratio": round(ind.volume_ratio, 2),
        },
    )
