"""Moteur NLP + décision de trading basé sur les préférences utilisateur.

Ce module implémente le cœur algorithmique de l'application :

* ``analyze_incoming_news`` : pipeline NLP simulé qui score chaque news
  certifiée (Bloomberg, Reuters, Benzinga, X/Twitter, RSS) en polarité,
  confiance source, probabilité haussière / baissière, secteur cible et
  durée de rétention dynamique (Time-To-Live).  Le signal scoré est
  persisté dans ``market_signals`` et marqué ``is_valid_signal=True``
  lorsqu'il dépasse 70 % de probabilité.
* ``evaluate_trading_opportunity`` : croise les signaux valides récents
  avec les préférences sectorielles, le seuil utilisateur, la classe
  d'actifs autorisée et le capital disponible pour ouvrir (ou non) une
  position dans ``active_trades`` avec un horizon de temps maximum.

Les fonctions sont totalement asynchrones (SQLAlchemy AsyncSession) et
strictement déterministes pour une même entrée (le bruit NLP est dérivé
d'un hash SHA-256), ce qui simplifie les tests de régression.
"""

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
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet


# ---------------------------------------------------------------------------
# Constantes publiques exportées par le moteur.
# ---------------------------------------------------------------------------

SECTOR_TECH = "tech"
SECTOR_MINES = "mines"
SECTOR_REAL_ESTATE = "real_estate"
SECTOR_INSURANCE = "insurance"
SECTOR_FOOD = "food"
SECTOR_GENERAL = "general"

ASSET_CRYPTO = "crypto"
ASSET_ETF = "etf"
ASSET_STOCK = "stocks"

#: Seuil de probabilité plancher imposé par la plateforme.  Un signal
#: ne peut jamais être validé en dessous, même si la préférence
#: utilisateur autorise un seuil plus bas.
MIN_SIGNAL_PROBABILITY = Decimal("70.00")

#: Plancher absolu de capital recommandé pour qu'un ordre soit envoyé.
MIN_RECOMMENDED_CAPITAL = Decimal("50.00")


# ---------------------------------------------------------------------------
# Dataclasses retournées par le moteur.
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class NewsAnalysisResult:
    """Sortie standard du pipeline de scoring news."""

    signal_id: uuid.UUID
    mapped_sector: str
    sentiment_polarity: str
    probability_bullish: Decimal
    probability_bearish: Decimal
    signal_strength: Decimal
    is_valid_signal: bool
    time_to_live_minutes: int
    expires_at: datetime


@dataclass(slots=True)
class TradingOpportunityResult:
    """Décision finale d'ouverture (ou de rejet) de position."""

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


# ---------------------------------------------------------------------------
# Helpers numériques.
# ---------------------------------------------------------------------------


def _quantize_probability(value: Decimal) -> Decimal:
    """Arrondit une probabilité à deux décimales (mode banker's half-up)."""

    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _clamp_decimal(value: Decimal, minimum: Decimal, maximum: Decimal) -> Decimal:
    """Borne ``value`` dans l'intervalle ``[minimum, maximum]``."""

    return max(minimum, min(value, maximum))


def _noise_from_text(news_text: str, category: str) -> Decimal:
    """Bruit déterministe dans ``[-6.00, +6.00]`` dérivé du texte d'entrée."""

    digest = hashlib.sha256(f"{category}:{news_text.lower()}".encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    return Decimal((seed % 1201) - 600) / Decimal("100")


# ---------------------------------------------------------------------------
# Sources, confiance et mots-clés.
# ---------------------------------------------------------------------------


def _extract_source(category: str) -> str:
    """Mappe la catégorie d'origine vers un identifiant de source certifiée."""

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
    """Confiance baseline associée à chaque source certifiée."""

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


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    """Compile un motif insensible à la casse avec frontières de mot lexicales.

    L'utilisation de lookarounds ``(?<![\\w])`` / ``(?![\\w])`` évite les
    faux positifs typiques : ``"or"`` (ticker Mines) ne matche plus
    ``"major"`` ni ``"forecast"``, ``"ai"`` ne matche plus ``"said"``.
    """

    escaped = re.escape(keyword)
    return re.compile(rf"(?<![\w]){escaped}(?![\w])", re.IGNORECASE)


_SECTOR_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        SECTOR_MINES,
        (
            "or", "gold", "lithium", "copper", "cuivre", "nickel",
            "mine", "mining", "miner", "miners", "mines",
            "platinum", "silver", "minerai", "minerais",
        ),
    ),
    (
        SECTOR_TECH,
        (
            "nvidia", "ai", "ia", "semiconductor", "semiconductors",
            "cloud", "software", "cyber", "cybersecurity",
            "chip", "chips", "saas", "datacenter", "tech",
        ),
    ),
    (
        SECTOR_REAL_ESTATE,
        (
            "real estate", "reit", "reits", "housing", "mortgage",
            "immobilier", "property", "properties",
        ),
    ),
    (
        SECTOR_INSURANCE,
        (
            "insurance", "insurer", "insurers", "reinsurance",
            "assurance", "sinistre", "sinistres",
        ),
    ),
    (
        SECTOR_FOOD,
        (
            "food", "agri", "agriculture", "wheat", "sugar",
            "alimentation", "beverage", "beverages",
        ),
    ),
)

_COMPILED_SECTOR_KEYWORDS: tuple[tuple[str, tuple[re.Pattern[str], ...]], ...] = tuple(
    (sector, tuple(_keyword_pattern(keyword) for keyword in keywords))
    for sector, keywords in _SECTOR_KEYWORDS
)


def _contains_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    """Retourne ``True`` si un mot-clé apparaît comme token complet."""

    return any(_keyword_pattern(keyword).search(text) for keyword in keywords)


def _map_sector(news_text: str) -> str:
    """Mappe une news vers un secteur via correspondance par frontière de mot."""

    for sector, patterns in _COMPILED_SECTOR_KEYWORDS:
        if any(pattern.search(news_text) for pattern in patterns):
            return sector
    return SECTOR_GENERAL


def _resolve_asset_class(category: str) -> str:
    """Devine la classe d'actif visée à partir de la catégorie source."""

    lowered = category.lower()
    if "crypto" in lowered or "binance" in lowered or "coinbase" in lowered:
        return ASSET_CRYPTO
    if "etf" in lowered:
        return ASSET_ETF
    return ASSET_STOCK


# ---------------------------------------------------------------------------
# Scoring polarité + probabilités.
# ---------------------------------------------------------------------------


_BULLISH_KEYWORDS: tuple[str, ...] = (
    "upgrade",
    "growth",
    "record",
    "beats",
    "partnership",
    "acquisition",
    "hausse",
    "bénéfice",
    "rally",
    "surge",
    "breakthrough",
)

_BEARISH_KEYWORDS: tuple[str, ...] = (
    "downgrade",
    "lawsuit",
    "fraud",
    "sanction",
    "sanctions",
    "baisse",
    "inflation",
    "rate hike",
    "warning",
    "crash",
    "plunge",
)


def _compute_probabilities(
    news_text: str,
    category: str,
    source_conf: Decimal,
) -> tuple[str, Decimal, Decimal]:
    """Calcule polarité, probabilité haussière et probabilité baissière.

    Le score combine :

    * une base de 58 %,
    * un bonus de 8.5 points par mot-clé directionnel détecté
      (haussier ou baissier confondu, pour reproduire l'intensité d'un
      modèle FinBERT),
    * un bonus pondéré par la confiance source,
    * un petit bonus dépendant de la classe d'actif (crypto/stocks plus
      volatils que ETF),
    * un bruit déterministe dérivé du SHA-256 du texte d'entrée.

    Le résultat est borné à ``[50, 99]`` puis quantifié à deux décimales.
    """

    bullish_hits = sum(
        1 for keyword in _BULLISH_KEYWORDS if _keyword_pattern(keyword).search(news_text)
    )
    bearish_hits = sum(
        1 for keyword in _BEARISH_KEYWORDS if _keyword_pattern(keyword).search(news_text)
    )

    base = Decimal("58.00")
    source_bonus = (source_conf - Decimal("70.00")) / Decimal("6.0")
    category_bonus = (
        Decimal("3.00")
        if _resolve_asset_class(category) in {ASSET_CRYPTO, ASSET_STOCK}
        else Decimal("1.50")
    )
    score = (
        base
        + (Decimal("8.50") * Decimal(bullish_hits + bearish_hits))
        + source_bonus
        + category_bonus
        + _noise_from_text(news_text, category)
    )
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
        _clamp_decimal(
            Decimal("52.00") + _noise_from_text(news_text, category),
            Decimal("45.00"),
            Decimal("65.00"),
        )
    )
    opposite = _quantize_probability(Decimal("100.00") - neutral_center)
    return ("neutral", neutral_center, opposite)


# ---------------------------------------------------------------------------
# Time-To-Live dynamique.
# ---------------------------------------------------------------------------


_MACRO_KEYWORDS: tuple[str, ...] = (
    "interest rate",
    "inflation",
    "central bank",
    "fed",
    "ecb",
    "macro",
)

_SHORT_LIFE_KEYWORDS: tuple[str, ...] = (
    "tweet",
    "post",
    "influencer",
    "rumor",
)


def _estimate_ttl_minutes(
    news_text: str,
    category: str,
    mapped_sector: str,
    strength: Decimal,
) -> int:
    """Estime la durée pendant laquelle un signal reste exploitable.

    Heuristique :

    * Macro-économique (taux, inflation, banque centrale) : 3 jours.
    * Tweet / post / rumeur d'influenceur : 45 minutes.
    * Mines : 18 h ; Tech : 8 h ; Crypto : 4 h ; reste : 6 h.

    Le TTL est ensuite étiré linéairement avec la force du signal et
    borné dans ``[30 min, 7 jours]``.
    """

    if _contains_keyword(news_text, _MACRO_KEYWORDS):
        base_ttl = 60 * 24 * 3
    elif _contains_keyword(news_text, _SHORT_LIFE_KEYWORDS):
        base_ttl = 45
    elif mapped_sector == SECTOR_MINES:
        base_ttl = 60 * 18
    elif mapped_sector == SECTOR_TECH:
        base_ttl = 60 * 8
    elif _resolve_asset_class(category) == ASSET_CRYPTO:
        base_ttl = 60 * 4
    else:
        base_ttl = 60 * 6

    confidence_multiplier = Decimal("1.0") + ((strength - Decimal("70.00")) / Decimal("100.0"))
    ttl = int(Decimal(base_ttl) * confidence_multiplier)
    return max(30, min(ttl, 60 * 24 * 7))


# ---------------------------------------------------------------------------
# Préférences utilisateur.
# ---------------------------------------------------------------------------


def _is_sector_enabled(preference: UserPreference, sector: str) -> bool:
    """Indique si le secteur ``sector`` est activé dans les préférences."""

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
    """Indique si la classe d'actifs ``asset_class`` est activée."""

    if asset_class == ASSET_CRYPTO:
        return preference.enable_crypto
    if asset_class == ASSET_ETF:
        return preference.enable_etf
    return preference.enable_stocks


def _default_preferences(user_id: uuid.UUID) -> UserPreference:
    """Préférences sectorielles par défaut (tech + mines, seuil 70 %)."""

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
    )


# ---------------------------------------------------------------------------
# API publique : analyse NLP d'une news + décision de trade.
# ---------------------------------------------------------------------------


async def analyze_incoming_news(news_text: str, category: str) -> NewsAnalysisResult:
    """Analyse une news entrante, calcule probabilités et persiste le signal.

    :param news_text: contenu textuel brut de la news (UTF-8).
    :param category: catégorie / source d'origine, libre-forme.  Sert à
        identifier la source certifiée (Bloomberg, Reuters, Benzinga, X,
        RSS) et la classe d'actif visée (crypto / etf / stock).
    :raises ValueError: si l'un des deux paramètres est vide.
    :returns: un :class:`NewsAnalysisResult` contenant la probabilité
        haussière/baissière, le secteur mappé, la durée de rétention
        dynamique et le statut ``is_valid_signal`` (True dès que la
        probabilité dominante dépasse :data:`MIN_SIGNAL_PROBABILITY`).
    """

    if not news_text or not news_text.strip():
        raise ValueError("news_text doit contenir du texte.")
    if not category or not category.strip():
        raise ValueError("category doit être renseignée.")

    # Cession de contrôle au scheduler asyncio pour préserver la
    # coopérativité même quand cette fonction est appelée en boucle.
    await asyncio.sleep(0)

    source = _extract_source(category)
    source_conf = _source_confidence(source)
    mapped_sector = _map_sector(news_text)
    polarity, bullish, bearish = _compute_probabilities(news_text, category, source_conf)
    strength = _quantize_probability(max(bullish, bearish))
    is_valid_signal = strength >= MIN_SIGNAL_PROBABILITY
    ttl_minutes = _estimate_ttl_minutes(news_text, category, mapped_sector, strength)
    expires_at = datetime.now(UTC) + timedelta(minutes=ttl_minutes)

    signal = MarketSignal(
        source=source,
        category=category.strip().lower(),
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
            "pipeline_version": "v1.0",
            "asset_class": _resolve_asset_class(category),
        },
    )

    async with AsyncSessionLocal() as session:
        session.add(signal)
        await session.commit()
        await session.refresh(signal)

    return NewsAnalysisResult(
        signal_id=signal.id,
        mapped_sector=signal.mapped_sector,
        sentiment_polarity=signal.sentiment_polarity,
        probability_bullish=signal.probability_bullish,
        probability_bearish=signal.probability_bearish,
        signal_strength=signal.signal_strength,
        is_valid_signal=signal.is_valid_signal,
        time_to_live_minutes=signal.time_to_live_minutes,
        expires_at=signal.expires_at,
    )


async def evaluate_trading_opportunity(user_id: uuid.UUID) -> TradingOpportunityResult:
    """Croise préférences utilisateur et signaux valides pour décider d'un trade.

    Étapes :

    1. Vérifie que l'utilisateur existe et est actif.
    2. Vérifie qu'un wallet est associé et qu'un capital disponible
       supérieur à zéro existe.
    3. Charge ou crée les préférences utilisateur par défaut.
    4. Sélectionne les signaux valides non expirés, triés par force
       décroissante.
    5. Filtre selon le seuil utilisateur, la classe d'actif et le
       secteur autorisé.
    6. Garantit l'idempotence : aucun nouveau trade n'est ouvert tant
       qu'une position est déjà ouverte sur le même signal.
    7. Ouvre une position ``ActiveTrade`` avec un capital recommandé
       (20 % du solde disponible, plancher :data:`MIN_RECOMMENDED_CAPITAL`)
       et un horizon de temps maximum ``planned_close_at``.

    :returns: un :class:`TradingOpportunityResult` détaillant la
        décision et — en cas d'exécution — l'identifiant du trade ouvert.
    """

    now = datetime.now(UTC)
    async with AsyncSessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None or not user.is_active:
            return TradingOpportunityResult(
                should_execute=False,
                reason="Utilisateur introuvable ou inactif.",
                user_id=user_id,
            )

        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == user_id))
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

        preference = await session.scalar(
            select(UserPreference).where(UserPreference.user_id == user_id)
        )
        if preference is None:
            preference = _default_preferences(user_id)
            session.add(preference)
            await session.flush()

        threshold = _quantize_probability(
            max(preference.minimum_probability_threshold, MIN_SIGNAL_PROBABILITY)
        )

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
            )

        eligible_signals: list[MarketSignal] = []
        for signal in recent_signals:
            asset_class = _resolve_asset_class(signal.category)
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
            )

        recommended_capital = _quantize_probability(
            min(
                wallet.solde_disponible,
                max(MIN_RECOMMENDED_CAPITAL, wallet.solde_disponible * Decimal("0.20")),
            )
        )
        if recommended_capital <= Decimal("0.00"):
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Capital recommandé insuffisant.",
                user_id=user_id,
                market_signal_id=selected_signal.id,
            )

        direction = "buy" if selected_signal.sentiment_polarity != "negative" else "sell"
        estimated_duration = max(30, selected_signal.time_to_live_minutes)
        planned_close = now + timedelta(minutes=estimated_duration)

        active_trade = ActiveTrade(
            user_id=user_id,
            market_signal_id=selected_signal.id,
            asset_class=_resolve_asset_class(selected_signal.category),
            sector=selected_signal.mapped_sector,
            direction=direction,
            probability_used=selected_signal.signal_strength,
            capital_engaged=recommended_capital,
            status="open",
            estimated_duration_minutes=estimated_duration,
            planned_close_at=planned_close,
        )
        session.add(active_trade)
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
        recommended_capital=recommended_capital,
        estimated_duration_minutes=estimated_duration,
        planned_close_at=planned_close,
        active_trade_id=active_trade.id,
    )
