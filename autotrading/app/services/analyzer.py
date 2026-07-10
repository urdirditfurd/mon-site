"""Analyse technique + score de probabilité achat/vente (MVP lemon)."""

from __future__ import annotations

import math
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
    bb_upper: float
    bb_middle: float
    bb_lower: float
    ema_50: float
    ema_200: float


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
    bb_upper, bb_middle, bb_lower = _bollinger(closes)
    ema_50 = _ema_series(closes, 50)[-1] if closes else 0.0
    ema_200 = _ema_series(closes, 200)[-1] if len(closes) >= 200 else _ema_series(closes, min(50, len(closes)))[-1]
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
        bb_upper=bb_upper,
        bb_middle=bb_middle,
        bb_lower=bb_lower,
        ema_50=ema_50,
        ema_200=ema_200,
    )


def _bollinger(closes: list[float], period: int = 20, mult: float = 2.0) -> tuple[float, float, float]:
    if len(closes) < period:
        m = mean(closes) if closes else 0.0
        return m, m, m
    slice_vals = closes[-period:]
    mid = mean(slice_vals)
    variance = sum((x - mid) ** 2 for x in slice_vals) / period
    sd = variance**0.5
    return mid + mult * sd, mid, mid - mult * sd


def _ema_series(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def _score_to_prob(score: float) -> float:
    return 0.3 + (score / 100) * 0.5


def _bayesian_combine(scores: list[float]) -> float:
    log_odds = 0.0
    for s in scores:
        p = _score_to_prob(s)
        p = max(0.01, min(0.99, p))
        log_odds += math.log(p / (1 - p))
    prob = 1 / (1 + math.exp(-log_odds / 4))
    return prob * 100


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def analyze_snapshot(snapshot: MarketSnapshot) -> AnalysisResult:
    """Transforme indicateurs techniques en probabilités compréhensibles pour débutants."""

    ind = compute_indicators(snapshot)
    price = snapshot.price

    # Scores par indicateur (0-100) — inspiré Qwen/OpenAlice
    rsi_score = 50.0
    if ind.rsi < 30:
        rsi_score = 95
    elif ind.rsi < 40:
        rsi_score = 75
    elif ind.rsi > 70:
        rsi_score = 15
    elif ind.rsi > 60:
        rsi_score = 35

    macd_score = 90.0 if ind.macd > ind.macd_signal else 15.0
    trend_score = 90.0 if ind.ema_50 > ind.ema_200 and price > ind.ema_50 else 15.0

    bb_range = ind.bb_upper - ind.bb_lower
    bb_pos = (price - ind.bb_lower) / bb_range if bb_range > 0 else 0.5
    bb_score = 90.0 if bb_pos < 0.1 else 15.0 if bb_pos > 0.9 else 50.0

    buy_probability = round(_bayesian_combine([rsi_score, macd_score, trend_score, bb_score]), 1)
    sell_probability = _clamp(100 - buy_probability + (ind.rsi - 50) * 0.3)

    if buy_probability >= 65 and ind.rsi < 72:
        signal = "ACHETER"
    elif sell_probability >= 60 or ind.rsi > 75:
        signal = "VENDRE"
    else:
        signal = "ATTENDRE"

    confidence = _clamp(abs(buy_probability - 50) * 1.6 + abs(ind.momentum_5d))

    bb_note = "proche bande basse Bollinger" if bb_pos < 0.2 else "proche bande haute" if bb_pos > 0.8 else "zone médiane Bollinger"
    reasoning_parts = [
        f"Prix actuel : {price:.2f} {snapshot.currency} ({snapshot.change_pct_24h:+.1f}% sur 24h).",
        f"RSI à {ind.rsi:.0f} — {'survente' if ind.rsi < 35 else 'surachat' if ind.rsi > 70 else 'neutre'}.",
        f"Tendance EMA50/200 : {'haussière' if ind.ema_50 > ind.ema_200 else 'baissière'}.",
        f"MACD {'haussier' if ind.macd > ind.macd_signal else 'baissier'}.",
        f"Bollinger : {bb_note}.",
        f"Probabilité bayésienne combinée : {buy_probability:.0f}%.",
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
            "bb_position": round(bb_pos, 3),
            "ema_50": round(ind.ema_50, 2),
            "ema_200": round(ind.ema_200, 2),
        },
    )
