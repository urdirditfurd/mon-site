"""Moteur de décision NLP + évaluation d'opportunités de trading.

Ce module constitue le cœur algorithmique de la plateforme.  Il expose
deux fonctions asynchrones de haut niveau :

* ``analyze_incoming_news``  — pipeline NLP simulé qui score une news
  entrante, la mappe vers un secteur/classe d'actifs, calcule la
  probabilité haussière/baissière, estime la durée de vie du signal,
  et persiste le résultat dans ``market_signals``.

* ``evaluate_trading_opportunity`` — croise les préférences d'un
  utilisateur (seuil de probabilité, filtres sectoriels, classes
  d'actifs, limite de positions concurrentes) avec les signaux récents
  valides pour décider si un trade doit être déclenché et pour quelle
  durée théorique.

Le code est entièrement asynchrone, déterministe (pas de ``random``),
et prêt pour un remplacement futur du scoring simulé par un vrai modèle
FinBERT / Llama-3-70B.
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import desc, func, select

from app.db.database import AsyncSessionLocal
from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
# Constantes Sectorielles & Classes d'Actifs
# ═══════════════════════════════════════════════════════════════════════

SECTOR_TECH = "tech"
SECTOR_MINES = "mines"
SECTOR_REAL_ESTATE = "real_estate"
SECTOR_INSURANCE = "insurance"
SECTOR_FOOD = "food"
SECTOR_ENERGY = "energy"
SECTOR_GENERAL = "general"

ALL_SECTORS = frozenset({
    SECTOR_TECH,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_INSURANCE,
    SECTOR_FOOD,
    SECTOR_ENERGY,
    SECTOR_GENERAL,
})

ASSET_CRYPTO = "crypto"
ASSET_ETF = "etf"
ASSET_STOCK = "stocks"

MIN_SIGNAL_PROBABILITY = Decimal("70.00")
MIN_RECOMMENDED_CAPITAL = Decimal("50.00")
DEFAULT_MAX_CONCURRENT_TRADES = 5
DEFAULT_CAPITAL_ALLOCATION_PCT = Decimal("20.00")

# ═══════════════════════════════════════════════════════════════════════
# Dataclasses de sortie
# ═══════════════════════════════════════════════════════════════════════


@dataclass(slots=True, frozen=True)
class NewsAnalysisResult:
    """Sortie standard du pipeline de scoring news."""

    signal_id: uuid.UUID
    mapped_sector: str
    asset_class: str
    direction: str
    sentiment_polarity: str
    probability_bullish: Decimal
    probability_bearish: Decimal
    signal_strength: Decimal
    is_valid_signal: bool
    time_to_live_minutes: int
    expires_at: datetime


@dataclass(slots=True, frozen=True)
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
    recommended_capital: Decimal | None = None
    estimated_duration_minutes: int | None = None
    planned_close_at: datetime | None = None
    active_trade_id: uuid.UUID | None = None


# ═══════════════════════════════════════════════════════════════════════
# Utilitaires arithmétiques
# ═══════════════════════════════════════════════════════════════════════


def _quantize(value: Decimal) -> Decimal:
    """Arrondi bancaire à deux décimales."""
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _clamp(value: Decimal, lo: Decimal, hi: Decimal) -> Decimal:
    return max(lo, min(value, hi))


def _deterministic_noise(news_text: str, category: str) -> Decimal:
    """Bruit déterministe dans [-6.00, +6.00] dérivé du contenu.

    Utilise SHA-256 pour garantir la reproductibilité des résultats
    sur un même couple (news_text, category).
    """
    digest = hashlib.sha256(
        f"{category.lower().strip()}:{news_text.lower().strip()}".encode("utf-8"),
    ).hexdigest()
    seed = int(digest[:8], 16)
    return Decimal((seed % 1201) - 600) / Decimal("100")


# ═══════════════════════════════════════════════════════════════════════
# Extraction de la source et de sa confiance
# ═══════════════════════════════════════════════════════════════════════

_SOURCE_CONFIDENCE_MAP: dict[str, Decimal] = {
    "bloomberg_enterprise": Decimal("95.00"),
    "reuters_api": Decimal("93.00"),
    "benzinga": Decimal("88.00"),
    "rss_certified": Decimal("80.00"),
    "certified_feed": Decimal("78.00"),
    "x_api_v2": Decimal("74.00"),
}


def _extract_source(category: str) -> str:
    """Déduit la source d'ingestion à partir de la catégorie."""
    lowered = category.lower()
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
    """Renvoie l'indice de confiance associé à une source connue."""
    return _SOURCE_CONFIDENCE_MAP.get(source, Decimal("78.00"))


# ═══════════════════════════════════════════════════════════════════════
# Mapping sectoriel (avec gestion des mots courts)
# ═══════════════════════════════════════════════════════════════════════

_SECTOR_RULES: list[tuple[str, list[str], list[re.Pattern[str]]]] = [
    (
        SECTOR_MINES,
        ["gold", "lithium", "copper", "cuivre", "nickel", "mine", "mining",
         "cobalt", "platine", "platinum", "palladium", "zinc", "aluminium",
         "iron ore", "minerai", "rare earth", "terres rares"],
        [re.compile(r"\bor\b", re.IGNORECASE)],
    ),
    (
        SECTOR_TECH,
        ["nvidia", "semiconductor", "cloud", "software", "cyber", "chip",
         "microprocessor", "saas", "fintech", "blockchain", "quantum",
         "computing", "intelligence artificielle", "machine learning",
         "deep learning", "apple", "google", "microsoft", "meta"],
        [
            re.compile(r"\bai\b", re.IGNORECASE),
            re.compile(r"\bia\b", re.IGNORECASE),
        ],
    ),
    (
        SECTOR_REAL_ESTATE,
        ["real estate", "reit", "housing", "mortgage", "immobilier",
         "property", "logement", "foncier", "construction résidentielle"],
        [],
    ),
    (
        SECTOR_INSURANCE,
        ["insurance", "assurance", "reinsurance", "insurer", "sinistre",
         "actuaire", "actuarial", "underwriting", "réassurance"],
        [],
    ),
    (
        SECTOR_FOOD,
        ["food", "agriculture", "wheat", "sugar", "alimentation", "beverage",
         "grain", "corn", "soybean", "livestock", "dairy", "céréales",
         "agroalimentaire", "cacao", "café", "coffee"],
        [re.compile(r"\bagri\b", re.IGNORECASE)],
    ),
    (
        SECTOR_ENERGY,
        ["oil", "gas", "petroleum", "pétrole", "gaz naturel", "natural gas",
         "solar", "wind energy", "éolien", "solaire", "nuclear", "nucléaire",
         "renewable", "renouvelable", "opec", "brent", "crude", "lng",
         "hydrogène", "hydrogen", "pipeline", "raffinerie", "refinery"],
        [],
    ),
]


def _map_sector(news_text: str) -> str:
    """Mappe une news vers un secteur en utilisant des mots-clés et des regex.

    Les mots courts (ex. ``or``, ``ai``, ``ia``) sont traités via des
    regex à frontière de mot (``\\b``) pour éviter les faux positifs
    (ex. « rapport », « corporatif »).
    """
    lowered = news_text.lower()
    for sector, keywords, patterns in _SECTOR_RULES:
        if any(kw in lowered for kw in keywords):
            return sector
        if any(pat.search(news_text) for pat in patterns):
            return sector
    return SECTOR_GENERAL


# ═══════════════════════════════════════════════════════════════════════
# Résolution de la classe d'actifs
# ═══════════════════════════════════════════════════════════════════════


def _resolve_asset_class(category: str) -> str:
    """Déduit la classe d'actifs à partir de la catégorie de la news."""
    lowered = category.lower()
    if any(token in lowered for token in ("crypto", "binance", "coinbase", "bitcoin", "ethereum")):
        return ASSET_CRYPTO
    if "etf" in lowered:
        return ASSET_ETF
    return ASSET_STOCK


# ═══════════════════════════════════════════════════════════════════════
# Calcul des probabilités (scoring NLP simulé)
# ═══════════════════════════════════════════════════════════════════════

_BULLISH_KEYWORDS: frozenset[str] = frozenset({
    "upgrade", "growth", "record", "beats", "partnership", "acquisition",
    "hausse", "bénéfice", "rally", "breakthrough", "expansion", "outperform",
    "surpasses", "profit", "croissance", "dividend", "dividende", "buyback",
    "rachat", "contrat", "approval", "homologation",
})

_BEARISH_KEYWORDS: frozenset[str] = frozenset({
    "downgrade", "lawsuit", "fraud", "sanction", "baisse", "inflation",
    "rate hike", "warning", "recall", "investigation", "default",
    "bankruptcy", "faillite", "licenciement", "amende", "fine", "delay",
    "retard", "shortfall", "deficit", "recession", "stagnation", "crash",
    "plunge", "sell-off",
})


def _compute_probabilities(
    news_text: str,
    category: str,
    source_conf: Decimal,
) -> tuple[str, Decimal, Decimal]:
    """Calcule polarité + probabilités haussière/baissière.

    La force du signal est construite additivement à partir de :
    - une base à 58 %,
    - un bonus proportionnel au nombre de mots-clés détectés,
    - un bonus de confiance lié à la source,
    - un bonus de catégorie (crypto/actions > ETF),
    - un bruit déterministe.
    """
    lowered = news_text.lower()
    bullish_hits = sum(kw in lowered for kw in _BULLISH_KEYWORDS)
    bearish_hits = sum(kw in lowered for kw in _BEARISH_KEYWORDS)

    base = Decimal("58.00")
    source_bonus = (source_conf - Decimal("70.00")) / Decimal("6.0")
    category_bonus = (
        Decimal("3.00")
        if _resolve_asset_class(category) in {ASSET_CRYPTO, ASSET_STOCK}
        else Decimal("1.50")
    )
    noise = _deterministic_noise(news_text, category)
    total_hits = Decimal(bullish_hits + bearish_hits)
    score = base + (Decimal("8.50") * total_hits) + source_bonus + category_bonus + noise
    strength = _quantize(_clamp(score, Decimal("50.00"), Decimal("99.00")))

    if bullish_hits > bearish_hits:
        p_bull = strength
        p_bear = _quantize(Decimal("100.00") - strength)
        return "positive", p_bull, p_bear

    if bearish_hits > bullish_hits:
        p_bear = strength
        p_bull = _quantize(Decimal("100.00") - strength)
        return "negative", p_bull, p_bear

    neutral = _quantize(_clamp(
        Decimal("52.00") + noise,
        Decimal("45.00"),
        Decimal("65.00"),
    ))
    opposite = _quantize(Decimal("100.00") - neutral)
    return "neutral", neutral, opposite


# ═══════════════════════════════════════════════════════════════════════
# Estimation de la durée de rétention (Time-To-Live)
# ═══════════════════════════════════════════════════════════════════════

_MACRO_KEYWORDS: frozenset[str] = frozenset({
    "interest rate", "taux d'intérêt", "inflation", "central bank",
    "banque centrale", "fed", "ecb", "bce", "macro", "gdp", "pib",
    "quantitative easing", "taper",
})

_SHORT_IMPACT_KEYWORDS: frozenset[str] = frozenset({
    "tweet", "post", "influencer", "rumor", "rumeur", "buzz", "meme",
})


def _estimate_ttl_minutes(
    news_text: str,
    category: str,
    mapped_sector: str,
    strength: Decimal,
) -> int:
    """Estime la durée de vie du signal en minutes.

    Logique :
    - News macro-économique → 3 jours (4 320 min).
    - Tweet / influenceur → 45 min.
    - Secteur mines → 18 h.
    - Secteur tech → 8 h.
    - Secteur énergie → 12 h.
    - Crypto → 4 h.
    - Défaut → 6 h.

    Le TTL est ensuite pondéré par la force du signal : un signal
    très fort augmente légèrement la fenêtre.
    """
    lowered = news_text.lower()

    if any(kw in lowered for kw in _MACRO_KEYWORDS):
        base_ttl = 60 * 24 * 3
    elif any(kw in lowered for kw in _SHORT_IMPACT_KEYWORDS):
        base_ttl = 45
    elif mapped_sector == SECTOR_MINES:
        base_ttl = 60 * 18
    elif mapped_sector == SECTOR_TECH:
        base_ttl = 60 * 8
    elif mapped_sector == SECTOR_ENERGY:
        base_ttl = 60 * 12
    elif _resolve_asset_class(category) == ASSET_CRYPTO:
        base_ttl = 60 * 4
    else:
        base_ttl = 60 * 6

    confidence_multiplier = Decimal("1.0") + (
        (strength - Decimal("70.00")) / Decimal("100.0")
    )
    ttl = int(Decimal(base_ttl) * confidence_multiplier)
    return max(30, min(ttl, 60 * 24 * 7))


# ═══════════════════════════════════════════════════════════════════════
# Vérification des préférences utilisateur
# ═══════════════════════════════════════════════════════════════════════

_SECTOR_PREFERENCE_MAP: dict[str, str] = {
    SECTOR_TECH: "sector_tech",
    SECTOR_MINES: "sector_mines",
    SECTOR_REAL_ESTATE: "sector_real_estate",
    SECTOR_INSURANCE: "sector_insurance",
    SECTOR_FOOD: "sector_food",
    SECTOR_ENERGY: "sector_energy",
}


def _is_sector_enabled(preference: UserPreference, sector: str) -> bool:
    """Vérifie si le secteur est activé dans les préférences."""
    attr_name = _SECTOR_PREFERENCE_MAP.get(sector)
    if attr_name is None:
        return True
    return bool(getattr(preference, attr_name, True))


def _is_asset_class_enabled(preference: UserPreference, asset_class: str) -> bool:
    """Vérifie si la classe d'actifs est activée dans les préférences."""
    if asset_class == ASSET_CRYPTO:
        return preference.enable_crypto
    if asset_class == ASSET_ETF:
        return preference.enable_etf
    return preference.enable_stocks


def _build_default_preferences(user_id: uuid.UUID) -> UserPreference:
    """Construit les préférences par défaut pour un nouvel utilisateur."""
    return UserPreference(
        user_id=user_id,
        minimum_probability_threshold=Decimal("70.00"),
        enable_crypto=True,
        enable_etf=True,
        enable_stocks=True,
        sector_tech=True,
        sector_mines=True,
        sector_real_estate=False,
        sector_insurance=False,
        sector_food=False,
        sector_energy=False,
        max_concurrent_trades=DEFAULT_MAX_CONCURRENT_TRADES,
        capital_allocation_pct=DEFAULT_CAPITAL_ALLOCATION_PCT,
    )


# ═══════════════════════════════════════════════════════════════════════
# Fonction publique n°1 — Pipeline d'analyse news
# ═══════════════════════════════════════════════════════════════════════


async def analyze_incoming_news(news_text: str, category: str) -> NewsAnalysisResult:
    """Analyse une news entrante via le pipeline NLP simulé.

    Étapes du pipeline :
    1. Validation des entrées.
    2. Extraction de la source et de son indice de confiance.
    3. Mapping sectoriel (mots-clés + regex frontière de mot).
    4. Résolution de la classe d'actifs.
    5. Calcul des probabilités haussière/baissière et de la polarité.
    6. Validation du signal (seuil ≥ 70 %).
    7. Estimation de la durée de rétention (TTL).
    8. Persistance dans ``market_signals``.

    Args:
        news_text: Texte brut de la news (titre + extrait).
        category: Canal d'ingestion (ex. ``"bloomberg_tech"``, ``"crypto_binance"``).

    Returns:
        ``NewsAnalysisResult`` contenant l'identifiant du signal persisté,
        les probabilités calculées et la durée de vie estimée.

    Raises:
        ValueError: Si ``news_text`` ou ``category`` sont vides.
    """
    if not news_text or not news_text.strip():
        raise ValueError("news_text doit contenir du texte.")
    if not category or not category.strip():
        raise ValueError("category doit être renseignée.")

    news_text = news_text.strip()
    category = category.strip().lower()

    source = _extract_source(category)
    source_conf = _source_confidence(source)
    mapped_sector = _map_sector(news_text)
    asset_class = _resolve_asset_class(category)
    polarity, prob_bullish, prob_bearish = _compute_probabilities(
        news_text, category, source_conf,
    )
    strength = _quantize(max(prob_bullish, prob_bearish))
    is_valid = strength >= MIN_SIGNAL_PROBABILITY

    ttl_minutes = _estimate_ttl_minutes(news_text, category, mapped_sector, strength)
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=ttl_minutes)

    if polarity == "positive":
        direction = "buy"
    elif polarity == "negative":
        direction = "sell"
    else:
        direction = "hold"

    signal = MarketSignal(
        source=source,
        category=category,
        news_text=news_text,
        mapped_sector=mapped_sector,
        asset_class=asset_class,
        direction=direction,
        sentiment_polarity=polarity,
        source_confidence=source_conf,
        probability_bullish=prob_bullish,
        probability_bearish=prob_bearish,
        signal_strength=strength,
        is_valid_signal=is_valid,
        time_to_live_minutes=ttl_minutes,
        expires_at=expires_at,
        metadata_json={
            "pipeline_version": "v2.0",
            "source_confidence": str(source_conf),
            "deterministic_noise": str(_deterministic_noise(news_text, category)),
        },
    )

    async with AsyncSessionLocal() as session:
        session.add(signal)
        await session.commit()
        await session.refresh(signal)

    logger.info(
        "Signal créé id=%s sector=%s asset=%s direction=%s strength=%s valid=%s ttl=%dmin",
        signal.id, mapped_sector, asset_class, direction,
        strength, is_valid, ttl_minutes,
    )

    return NewsAnalysisResult(
        signal_id=signal.id,
        mapped_sector=signal.mapped_sector,
        asset_class=signal.asset_class,
        direction=signal.direction,
        sentiment_polarity=signal.sentiment_polarity,
        probability_bullish=signal.probability_bullish,
        probability_bearish=signal.probability_bearish,
        signal_strength=signal.signal_strength,
        is_valid_signal=signal.is_valid_signal,
        time_to_live_minutes=signal.time_to_live_minutes,
        expires_at=signal.expires_at,
    )


# ═══════════════════════════════════════════════════════════════════════
# Fonction publique n°2 — Évaluation d'une opportunité de trading
# ═══════════════════════════════════════════════════════════════════════


async def evaluate_trading_opportunity(
    user_id: uuid.UUID,
) -> TradingOpportunityResult:
    """Croise les préférences utilisateur et les signaux pour déclencher un trade.

    Étapes de l'évaluation :
    1. Vérification de l'existence et du statut de l'utilisateur.
    2. Vérification du solde disponible dans le wallet.
    3. Chargement (ou création) des préférences utilisateur.
    4. Vérification du nombre de positions ouvertes vs ``max_concurrent_trades``.
    5. Récupération des signaux valides et non expirés, triés par force
       décroissante.
    6. Filtrage des signaux selon les classes d'actifs et secteurs activés,
       et selon le seuil de probabilité.
    7. Exclusion des signaux déjà exploités par une position ouverte de
       cet utilisateur.
    8. Calcul du capital recommandé (``capital_allocation_pct`` du solde
       disponible, plafonné par le solde réel).
    9. Création de l'``ActiveTrade`` et engagement du capital dans le wallet.

    Args:
        user_id: Identifiant de l'utilisateur à évaluer.

    Returns:
        ``TradingOpportunityResult`` indiquant si un trade a été ouvert
        et ses paramètres.
    """
    now = datetime.now(UTC)

    def _reject(reason: str, **kwargs: object) -> TradingOpportunityResult:
        logger.info("Opportunité rejetée user=%s reason=%s", user_id, reason)
        return TradingOpportunityResult(
            should_execute=False, reason=reason, user_id=user_id, **kwargs,  # type: ignore[arg-type]
        )

    async with AsyncSessionLocal() as session:
        # ── 1. Utilisateur ────────────────────────────────────────────
        user = await session.get(User, user_id)
        if user is None or not user.is_active:
            return _reject("Utilisateur introuvable ou inactif.")

        # ── 2. Wallet ─────────────────────────────────────────────────
        wallet = await session.scalar(
            select(Wallet).where(Wallet.user_id == user_id),
        )
        if wallet is None:
            return _reject("Wallet introuvable.")
        if wallet.solde_disponible <= Decimal("0.00"):
            return _reject("Aucun capital disponible pour un nouveau trade.")

        # ── 3. Préférences ────────────────────────────────────────────
        preference = await session.scalar(
            select(UserPreference).where(UserPreference.user_id == user_id),
        )
        if preference is None:
            preference = _build_default_preferences(user_id)
            session.add(preference)
            await session.flush()

        threshold = _quantize(max(
            preference.minimum_probability_threshold,
            MIN_SIGNAL_PROBABILITY,
        ))

        # ── 4. Limite de positions concurrentes ───────────────────────
        open_trades_count: int = await session.scalar(
            select(func.count(ActiveTrade.id)).where(
                ActiveTrade.user_id == user_id,
                ActiveTrade.status == "open",
            ),
        ) or 0

        max_concurrent = preference.max_concurrent_trades or DEFAULT_MAX_CONCURRENT_TRADES
        if open_trades_count >= max_concurrent:
            return _reject(
                f"Limite de positions concurrentes atteinte ({open_trades_count}/{max_concurrent}).",
            )

        # ── 5. Signaux valides récents ────────────────────────────────
        recent_signals: list[MarketSignal] = list(
            (
                await session.execute(
                    select(MarketSignal)
                    .where(
                        MarketSignal.is_valid_signal.is_(True),
                        MarketSignal.expires_at > now,
                    )
                    .order_by(
                        desc(MarketSignal.signal_strength),
                        desc(MarketSignal.created_at),
                    )
                    .limit(50),
                )
            ).scalars(),
        )

        if not recent_signals:
            await session.commit()
            return _reject("Aucun signal valide récent.")

        # ── 6. IDs des signaux déjà exploités par l'utilisateur ───────
        exploited_signal_ids: set[uuid.UUID] = set(
            (
                await session.execute(
                    select(ActiveTrade.market_signal_id).where(
                        ActiveTrade.user_id == user_id,
                        ActiveTrade.status == "open",
                        ActiveTrade.market_signal_id.is_not(None),
                    ),
                )
            ).scalars(),
        )

        # ── 7. Filtrage multi-critères ────────────────────────────────
        eligible_signals: list[MarketSignal] = []
        for signal in recent_signals:
            if not _is_asset_class_enabled(preference, signal.asset_class):
                continue
            if not _is_sector_enabled(preference, signal.mapped_sector):
                continue
            if signal.signal_strength < threshold:
                continue
            if signal.id in exploited_signal_ids:
                continue
            eligible_signals.append(signal)

        if not eligible_signals:
            await session.commit()
            return _reject("Signaux non alignés avec les préférences utilisateur.")

        selected_signal = eligible_signals[0]

        # ── 8. Calcul du capital recommandé ───────────────────────────
        allocation_pct = preference.capital_allocation_pct or DEFAULT_CAPITAL_ALLOCATION_PCT
        raw_capital = wallet.solde_disponible * (allocation_pct / Decimal("100.00"))
        recommended_capital = _quantize(
            min(wallet.solde_disponible, max(MIN_RECOMMENDED_CAPITAL, raw_capital)),
        )

        if recommended_capital <= Decimal("0.00"):
            await session.commit()
            return _reject(
                "Capital recommandé insuffisant.",
                market_signal_id=selected_signal.id,
            )

        # ── 9. Direction et durée ─────────────────────────────────────
        direction = selected_signal.direction
        if direction == "hold":
            direction = "buy"
        estimated_duration = max(30, selected_signal.time_to_live_minutes)
        planned_close = now + timedelta(minutes=estimated_duration)

        # ── 10. Création de la position ───────────────────────────────
        active_trade = ActiveTrade(
            user_id=user_id,
            market_signal_id=selected_signal.id,
            asset_class=selected_signal.asset_class,
            sector=selected_signal.mapped_sector,
            direction=direction,
            probability_used=selected_signal.signal_strength,
            capital_engaged=recommended_capital,
            status="open",
            estimated_duration_minutes=estimated_duration,
            planned_close_at=planned_close,
        )
        session.add(active_trade)

        # ── 11. Engagement du capital dans le wallet ──────────────────
        wallet.solde_disponible -= recommended_capital
        wallet.solde_engage += recommended_capital
        session.add(wallet)

        await session.commit()
        await session.refresh(active_trade)

    logger.info(
        "Opportunité validée user=%s signal=%s direction=%s sector=%s "
        "capital=%s duration=%dmin",
        user_id, selected_signal.id, direction,
        selected_signal.mapped_sector, recommended_capital,
        estimated_duration,
    )

    return TradingOpportunityResult(
        should_execute=True,
        reason="Opportunité validée: alignement signal + préférences.",
        user_id=user_id,
        market_signal_id=selected_signal.id,
        direction=direction,
        asset_class=active_trade.asset_class,
        sector=selected_signal.mapped_sector,
        probability_used=selected_signal.signal_strength,
        recommended_capital=recommended_capital,
        estimated_duration_minutes=estimated_duration,
        planned_close_at=planned_close,
        active_trade_id=active_trade.id,
    )
