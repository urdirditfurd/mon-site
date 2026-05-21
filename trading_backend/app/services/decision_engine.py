"""Moteur NLP + décision trading basé sur préférences utilisateur."""

from __future__ import annotations

import asyncio
import hashlib
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import desc, select

from app.db.database import AsyncSessionLocal
from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet

SECTOR_TECH = "tech"
SECTOR_MINES = "mines"
SECTOR_REAL_ESTATE = "real_estate"
SECTOR_INSURANCE = "insurance"
SECTOR_FOOD = "food"
SECTOR_GENERAL = "general"

ASSET_CRYPTO = "crypto"
ASSET_ETF = "etf"
ASSET_STOCK = "stocks"

MIN_SIGNAL_PROBABILITY = Decimal("70.00")
MIN_RECOMMENDED_CAPITAL = Decimal("50.00")
PIPELINE_VERSION = "v1.1"

SECTOR_KEYWORDS: dict[str, tuple[str, ...]] = {
    SECTOR_MINES: ("or", "gold", "lithium", "copper", "cuivre", "nickel", "mine", "mining"),
    SECTOR_TECH: ("nvidia", "ai", "ia", "semiconductor", "cloud", "software", "cyber", "chip", "oracle"),
    SECTOR_REAL_ESTATE: ("real estate", "reit", "housing", "mortgage", "immobilier", "property"),
    SECTOR_INSURANCE: ("insurance", "assurance", "reinsurance", "insurer", "sinistre"),
    SECTOR_FOOD: ("food", "agri", "agriculture", "wheat", "sugar", "alimentation", "beverage"),
}
BULLISH_KEYWORDS = (
    "upgrade",
    "growth",
    "record",
    "beats",
    "partnership",
    "acquisition",
    "hausse",
    "benefit",
    "bénéfice",
    "approval",
)
BEARISH_KEYWORDS = (
    "downgrade",
    "lawsuit",
    "fraud",
    "sanction",
    "baisse",
    "inflation",
    "rate hike",
    "warning",
    "misses",
    "probe",
)
LONG_HORIZON_KEYWORDS = ("interest rate", "inflation", "central bank", "fed", "ecb", "macro", "tariff")
SHORT_HORIZON_KEYWORDS = ("tweet", "post", "influencer", "rumor", "rumour", "viral")


@dataclass(slots=True)
class NewsAnalysisResult:
    """Sortie standard du pipeline de scoring news."""

    signal_id: uuid.UUID
    source: str
    source_confidence: Decimal
    asset_class: str
    mapped_sector: str
    sentiment_polarity: str
    probability_bullish: Decimal
    probability_bearish: Decimal
    signal_strength: Decimal
    is_valid_signal: bool
    time_to_live_minutes: int
    time_horizon_label: str
    ttl_reason: str
    expires_at: datetime


@dataclass(slots=True)
class TradingOpportunityResult:
    """Décision finale d'ouverture de position."""

    should_execute: bool
    reason: str
    user_id: uuid.UUID
    market_signal_id: uuid.UUID | None = None
    direction: str | None = None
    asset_class: str | None = None
    sector: str | None = None
    probability_used: Decimal | None = None
    threshold_used: Decimal | None = None
    recommended_capital: Decimal | None = None
    remaining_available_capital: Decimal | None = None
    estimated_duration_minutes: int | None = None
    time_horizon_label: str | None = None
    planned_close_at: datetime | None = None
    active_trade_id: uuid.UUID | None = None


def _quantize_probability(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _clamp_decimal(value: Decimal, minimum: Decimal, maximum: Decimal) -> Decimal:
    return max(minimum, min(value, maximum))


def _normalize_text(value: str) -> str:
    return value.strip().lower()


def _contains_keyword(lowered_text: str, keyword: str) -> bool:
    if " " in keyword or "-" in keyword:
        return keyword in lowered_text
    return re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", lowered_text) is not None


def _count_keyword_hits(lowered_text: str, keywords: tuple[str, ...]) -> int:
    return sum(1 for keyword in keywords if _contains_keyword(lowered_text, keyword))


def _noise_from_text(news_text: str, category: str) -> Decimal:
    digest = hashlib.sha256(f"{category}:{_normalize_text(news_text)}".encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    # Bruit déterministe [-6.00, +6.00]
    return Decimal((seed % 1201) - 600) / Decimal("100")


def _extract_source(category: str) -> str:
    lowered = _normalize_text(category)
    if "bloomberg" in lowered:
        return "bloomberg_enterprise"
    if "reuters" in lowered:
        return "reuters_api"
    if "benzinga" in lowered:
        return "benzinga"
    if "x" in lowered or "twitter" in lowered:
        return "x_api_v2"
    if "rss" in lowered:
        return "rss_certified"
    return "certified_feed"


def _source_confidence(source: str) -> Decimal:
    if source == "bloomberg_enterprise":
        return Decimal("95.00")
    if source == "reuters_api":
        return Decimal("93.00")
    if source == "benzinga":
        return Decimal("88.00")
    if source == "x_api_v2":
        return Decimal("74.00")
    if source == "rss_certified":
        return Decimal("80.00")
    return Decimal("78.00")


def _map_sector(news_text: str) -> str:
    lowered = _normalize_text(news_text)
    best_sector = SECTOR_GENERAL
    best_hits = 0
    for sector, keywords in SECTOR_KEYWORDS.items():
        hits = _count_keyword_hits(lowered, keywords)
        if hits > best_hits:
            best_sector = sector
            best_hits = hits
    return best_sector


def _resolve_asset_class(category: str) -> str:
    lowered = _normalize_text(category)
    if "crypto" in lowered or "binance" in lowered or "coinbase" in lowered:
        return ASSET_CRYPTO
    if "etf" in lowered:
        return ASSET_ETF
    return ASSET_STOCK


def _compute_probabilities(news_text: str, category: str, source_conf: Decimal) -> tuple[str, Decimal, Decimal]:
    lowered = _normalize_text(news_text)
    bullish_hits = _count_keyword_hits(lowered, BULLISH_KEYWORDS)
    bearish_hits = _count_keyword_hits(lowered, BEARISH_KEYWORDS)

    base = Decimal("58.00")
    source_bonus = (source_conf - Decimal("70.00")) / Decimal("6.0")
    category_bonus = Decimal("3.00") if _resolve_asset_class(category) in {ASSET_CRYPTO, ASSET_STOCK} else Decimal("1.50")
    score = base + (Decimal("8.50") * Decimal(bullish_hits + bearish_hits)) + source_bonus + category_bonus + _noise_from_text(news_text, category)
    strength = _quantize_probability(_clamp_decimal(score, Decimal("50.00"), Decimal("99.00")))

    if bullish_hits > bearish_hits:
        probability_bullish = strength
        probability_bearish = _quantize_probability(Decimal("100.00") - strength)
        return ("positive", probability_bullish, probability_bearish)
    if bearish_hits > bullish_hits:
        probability_bearish = strength
        probability_bullish = _quantize_probability(Decimal("100.00") - strength)
        return ("negative", probability_bullish, probability_bearish)

    neutral_center = _quantize_probability(
        _clamp_decimal(Decimal("52.00") + _noise_from_text(news_text, category), Decimal("45.00"), Decimal("65.00"))
    )
    opposite = _quantize_probability(Decimal("100.00") - neutral_center)
    return ("neutral", neutral_center, opposite)


def _estimate_ttl_profile(
    news_text: str,
    category: str,
    mapped_sector: str,
    strength: Decimal,
) -> tuple[int, str, str]:
    lowered = _normalize_text(news_text)
    asset_class = _resolve_asset_class(category)

    if any(keyword in lowered for keyword in LONG_HORIZON_KEYWORDS):
        base_ttl = 60 * 24 * 3
        time_horizon_label = "macro_multi_day"
        ttl_reason = "Catalyseur macro-économique: impact attendu sur plusieurs séances."
    elif any(keyword in lowered for keyword in SHORT_HORIZON_KEYWORDS):
        base_ttl = 45
        time_horizon_label = "social_short_burst"
        ttl_reason = "Signal social ou rumeur: fenêtre d'exploitation très courte."
    elif mapped_sector == SECTOR_MINES:
        base_ttl = 60 * 18
        time_horizon_label = "commodities_swing"
        ttl_reason = "Les news minières et matières premières diffusent souvent leur impact sur plusieurs heures."
    elif mapped_sector == SECTOR_TECH:
        base_ttl = 60 * 8
        time_horizon_label = "tech_intraday"
        ttl_reason = "Les catalyseurs technologiques produisent souvent un mouvement intraday prolongé."
    elif asset_class == ASSET_CRYPTO:
        base_ttl = 60 * 4
        time_horizon_label = "crypto_fast"
        ttl_reason = "Le marché crypto réagit vite, avec une demi-vie informationnelle courte."
    else:
        base_ttl = 60 * 6
        time_horizon_label = "event_intraday"
        ttl_reason = "Signal événementiel standard à horizon intraday."

    confidence_multiplier = Decimal("1.0") + ((strength - Decimal("70.00")) / Decimal("100.0"))
    ttl = int(Decimal(base_ttl) * confidence_multiplier)
    return (max(30, min(ttl, 60 * 24 * 7)), time_horizon_label, ttl_reason)


def _is_sector_enabled(preference: UserPreference, sector: str) -> bool:
    if sector == SECTOR_TECH:
        return preference.sector_tech
    if sector == SECTOR_MINES:
        return preference.sector_mines
    if sector == SECTOR_REAL_ESTATE:
        return preference.sector_real_estate
    if sector == SECTOR_INSURANCE:
        return preference.sector_insurance
    if sector == SECTOR_FOOD:
        return preference.sector_food
    return True


def _is_asset_class_enabled(preference: UserPreference, asset_class: str) -> bool:
    if asset_class == ASSET_CRYPTO:
        return preference.enable_crypto
    if asset_class == ASSET_ETF:
        return preference.enable_etf
    return preference.enable_stocks


def _default_preferences(
    user_id: uuid.UUID,
    threshold: Decimal = MIN_SIGNAL_PROBABILITY,
) -> UserPreference:
    return UserPreference(
        user_id=user_id,
        minimum_probability_threshold=_quantize_probability(threshold),
        enable_crypto=True,
        enable_etf=True,
        enable_stocks=True,
        sector_tech=True,
        sector_mines=True,
        sector_real_estate=False,
        sector_insurance=False,
        sector_food=False,
    )


def _resolve_effective_threshold(
    preference: UserPreference,
    trading_profile: TradingProfile | None,
) -> Decimal:
    thresholds = [MIN_SIGNAL_PROBABILITY, preference.minimum_probability_threshold]
    if trading_profile is not None:
        thresholds.append(trading_profile.seuil_probabilite_min)
    # Le système retient le seuil le plus strict pour éviter un déclenchement plus permissif
    # qu'attendu par l'utilisateur dans l'une des couches de configuration.
    return _quantize_probability(max(thresholds))


def _recommend_capital(available_capital: Decimal) -> Decimal:
    if available_capital <= Decimal("0.00"):
        return Decimal("0.00")
    return _quantize_money(
        min(
            available_capital,
            max(MIN_RECOMMENDED_CAPITAL, available_capital * Decimal("0.20")),
        )
    )


def _reserve_capital(wallet: Wallet, capital: Decimal) -> None:
    if capital <= Decimal("0.00"):
        raise ValueError("Le capital réservé doit être strictement positif.")
    if wallet.solde_disponible < capital:
        raise ValueError("Le solde disponible est insuffisant pour réserver ce capital.")
    wallet.solde_disponible = _quantize_money(wallet.solde_disponible - capital)
    wallet.solde_engage = _quantize_money(wallet.solde_engage + capital)


def _resolve_signal_asset_class(signal: MarketSignal) -> str:
    if signal.metadata_json and isinstance(signal.metadata_json, dict):
        asset_class = signal.metadata_json.get("asset_class")
        if isinstance(asset_class, str) and asset_class:
            return asset_class
    return _resolve_asset_class(signal.category)


def _resolve_signal_time_horizon(signal: MarketSignal) -> str | None:
    if signal.metadata_json and isinstance(signal.metadata_json, dict):
        time_horizon_label = signal.metadata_json.get("time_horizon_label")
        if isinstance(time_horizon_label, str):
            return time_horizon_label
    return None


async def analyze_incoming_news(news_text: str, category: str) -> NewsAnalysisResult:
    """Analyse une news entrante, calcule probabilités et persiste le signal."""

    if not news_text or not news_text.strip():
        raise ValueError("news_text doit contenir du texte.")
    if not category or not category.strip():
        raise ValueError("category doit être renseignée.")

    await asyncio.sleep(0)

    normalized_category = _normalize_text(category)
    source = _extract_source(normalized_category)
    source_conf = _source_confidence(source)
    asset_class = _resolve_asset_class(normalized_category)
    mapped_sector = _map_sector(news_text)
    polarity, bullish, bearish = _compute_probabilities(news_text, normalized_category, source_conf)
    strength = _quantize_probability(max(bullish, bearish))
    is_valid_signal = strength >= MIN_SIGNAL_PROBABILITY
    ttl_minutes, time_horizon_label, ttl_reason = _estimate_ttl_profile(news_text, normalized_category, mapped_sector, strength)
    expires_at = datetime.now(UTC) + timedelta(minutes=ttl_minutes)

    signal = MarketSignal(
        source=source,
        category=normalized_category,
        news_text=news_text.strip(),
        mapped_sector=mapped_sector,
        sentiment_polarity=polarity,
        source_confidence=source_conf,
        probability_bullish=bullish,
        probability_bearish=bearish,
        signal_strength=strength,
        is_valid_signal=is_valid_signal,
        time_to_live_minutes=ttl_minutes,
        expires_at=expires_at,
        metadata_json={
            "pipeline_version": PIPELINE_VERSION,
            "asset_class": asset_class,
            "time_horizon_label": time_horizon_label,
            "ttl_reason": ttl_reason,
            "minimum_valid_probability": str(MIN_SIGNAL_PROBABILITY),
        },
    )

    async with AsyncSessionLocal() as session:
        session.add(signal)
        await session.commit()
        await session.refresh(signal)

    return NewsAnalysisResult(
        signal_id=signal.id,
        source=signal.source,
        source_confidence=signal.source_confidence,
        asset_class=asset_class,
        mapped_sector=signal.mapped_sector,
        sentiment_polarity=signal.sentiment_polarity,
        probability_bullish=signal.probability_bullish,
        probability_bearish=signal.probability_bearish,
        signal_strength=signal.signal_strength,
        is_valid_signal=signal.is_valid_signal,
        time_to_live_minutes=signal.time_to_live_minutes,
        time_horizon_label=time_horizon_label,
        ttl_reason=ttl_reason,
        expires_at=signal.expires_at,
    )


async def evaluate_trading_opportunity(user_id: uuid.UUID) -> TradingOpportunityResult:
    """Croise préférences utilisateur et signaux valides pour décider d'un trade."""

    now = datetime.now(UTC)
    async with AsyncSessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None or not user.is_active:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Utilisateur introuvable ou inactif.",
                user_id=user_id,
            )

        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == user_id).with_for_update())
        if wallet is None:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Wallet introuvable.",
                user_id=user_id,
            )
        if wallet.solde_disponible <= Decimal("0.00"):
            return TradingOpportunityResult(
                should_execute=False,
                reason="Aucun capital disponible pour un nouveau trade.",
                user_id=user_id,
            )

        trading_profile = await session.scalar(
            select(TradingProfile).where(TradingProfile.user_id == user_id).with_for_update()
        )
        preference = await session.scalar(
            select(UserPreference).where(UserPreference.user_id == user_id).with_for_update()
        )
        if preference is None:
            default_threshold = (
                trading_profile.seuil_probabilite_min if trading_profile is not None else MIN_SIGNAL_PROBABILITY
            )
            preference = _default_preferences(user_id=user_id, threshold=default_threshold)
            session.add(preference)
            await session.flush()

        threshold = _resolve_effective_threshold(preference, trading_profile)

        recent_signals = (
            await session.execute(
                select(MarketSignal)
                .where(
                    MarketSignal.is_valid_signal.is_(True),
                    MarketSignal.expires_at > now,
                )
                .order_by(desc(MarketSignal.signal_strength), desc(MarketSignal.created_at))
                .limit(50)
            )
        ).scalars().all()

        if not recent_signals:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Aucun signal valide récent.",
                user_id=user_id,
                threshold_used=threshold,
            )

        eligible_signals: list[MarketSignal] = []
        for signal in recent_signals:
            asset_class = _resolve_signal_asset_class(signal)
            if not _is_asset_class_enabled(preference, asset_class):
                continue
            if not _is_sector_enabled(preference, signal.mapped_sector):
                continue
            if signal.signal_strength < threshold:
                continue
            eligible_signals.append(signal)

        if not eligible_signals:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Signaux non alignés avec les préférences utilisateur.",
                user_id=user_id,
                threshold_used=threshold,
            )

        selected_signal = eligible_signals[0]
        existing_trade = await session.scalar(
            select(ActiveTrade).where(
                ActiveTrade.user_id == user_id,
                ActiveTrade.market_signal_id == selected_signal.id,
                ActiveTrade.status == "open",
            )
        )
        if existing_trade is not None:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Signal déjà exploité par une position ouverte.",
                user_id=user_id,
                market_signal_id=selected_signal.id,
                threshold_used=threshold,
            )

        if selected_signal.sentiment_polarity == "neutral":
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Signal neutre: aucune direction exploitable.",
                user_id=user_id,
                market_signal_id=selected_signal.id,
                threshold_used=threshold,
            )

        recommended_capital = _recommend_capital(wallet.solde_disponible)
        if recommended_capital <= Decimal("0.00"):
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Capital recommandé insuffisant.",
                user_id=user_id,
                market_signal_id=selected_signal.id,
                threshold_used=threshold,
            )

        direction = "buy" if selected_signal.sentiment_polarity == "positive" else "sell"
        estimated_duration = max(30, selected_signal.time_to_live_minutes)
        planned_close = now + timedelta(minutes=estimated_duration)
        asset_class = _resolve_signal_asset_class(selected_signal)
        time_horizon_label = _resolve_signal_time_horizon(selected_signal)

        _reserve_capital(wallet, recommended_capital)
        active_trade = ActiveTrade(
            user_id=user_id,
            market_signal_id=selected_signal.id,
            asset_class=asset_class,
            sector=selected_signal.mapped_sector,
            direction=direction,
            probability_used=selected_signal.signal_strength,
            capital_engaged=recommended_capital,
            status="open",
            estimated_duration_minutes=estimated_duration,
            planned_close_at=planned_close,
        )
        session.add_all([wallet, active_trade])
        await session.commit()
        await session.refresh(active_trade)

    return TradingOpportunityResult(
        should_execute=True,
        reason="Opportunité validée: alignement signal + préférences.",
        user_id=user_id,
        market_signal_id=selected_signal.id,
        direction=direction,
        asset_class=active_trade.asset_class,
        sector=selected_signal.mapped_sector,
        probability_used=selected_signal.signal_strength,
        threshold_used=threshold,
        recommended_capital=recommended_capital,
        remaining_available_capital=wallet.solde_disponible,
        estimated_duration_minutes=estimated_duration,
        time_horizon_label=time_horizon_label,
        planned_close_at=planned_close,
        active_trade_id=active_trade.id,
    )
