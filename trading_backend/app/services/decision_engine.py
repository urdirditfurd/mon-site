"""Moteur NLP + décision trading basé sur préférences utilisateur.

Ce module constitue le cœur algorithmique du système de trading piloté par
le sentiment de marché.  Il enchaîne trois responsabilités :

1. **Analyse NLP simulée** – scoring de probabilité haussière/baissière,
   mapping sectoriel par mots-clés pondérés, classification de rétention
   temporelle (macro / corporate / social_media).
2. **Évaluation d'opportunité** – croisement des signaux valides avec les
   préférences utilisateur, calcul du capital recommandé, gestion des
   positions concurrentes et déduction du solde disponible.
3. **Clôture de positions expirées** – simulation de PnL, recrédit du
   wallet, génération de notifications de fin de cycle.
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import desc, select, update

from app.db.database import AsyncSessionLocal
from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes – Secteurs & Classes d'actifs
# ---------------------------------------------------------------------------

SECTOR_TECH = "tech"
SECTOR_MINES = "mines"
SECTOR_REAL_ESTATE = "real_estate"
SECTOR_INSURANCE = "insurance"
SECTOR_FOOD = "food"
SECTOR_ENERGY = "energy"
SECTOR_HEALTHCARE = "healthcare"
SECTOR_GENERAL = "general"

ALL_SECTORS = frozenset({
    SECTOR_TECH,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_INSURANCE,
    SECTOR_FOOD,
    SECTOR_ENERGY,
    SECTOR_HEALTHCARE,
    SECTOR_GENERAL,
})

ASSET_CRYPTO = "crypto"
ASSET_ETF = "etf"
ASSET_STOCK = "stocks"

MIN_SIGNAL_PROBABILITY = Decimal("70.00")
MIN_RECOMMENDED_CAPITAL = Decimal("50.00")
MAX_SIGNAL_AGE_HOURS = 48

# ---------------------------------------------------------------------------
# Dictionnaires de mots-clés pondérés par secteur
# ---------------------------------------------------------------------------

SECTOR_KEYWORDS: dict[str, dict[str, float]] = {
    SECTOR_MINES: {
        "or": 1.0, "gold": 1.0, "lithium": 1.2, "copper": 1.0, "cuivre": 1.0,
        "nickel": 1.0, "mine": 0.9, "mining": 0.9, "cobalt": 1.1, "iron ore": 1.0,
        "rare earth": 1.3, "terres rares": 1.3, "uranium": 1.2, "zinc": 0.9,
        "palladium": 1.0, "platinum": 1.0, "silver": 0.9, "argent métal": 0.9,
    },
    SECTOR_TECH: {
        "nvidia": 1.3, "ai": 1.2, "ia": 1.2, "semiconductor": 1.1, "cloud": 1.0,
        "software": 0.9, "cyber": 1.0, "chip": 1.0, "apple": 1.1, "google": 1.1,
        "microsoft": 1.1, "meta": 1.0, "tesla": 1.1, "startup": 0.8, "saas": 0.9,
        "machine learning": 1.2, "quantum": 1.3, "robot": 1.0, "5g": 0.9,
    },
    SECTOR_REAL_ESTATE: {
        "real estate": 1.0, "reit": 1.1, "housing": 1.0, "mortgage": 1.0,
        "immobilier": 1.0, "property": 0.9, "loyer": 0.9, "construction": 0.8,
        "logement": 0.9, "hypothèque": 1.0, "foncier": 0.9,
    },
    SECTOR_INSURANCE: {
        "insurance": 1.0, "assurance": 1.0, "reinsurance": 1.1, "insurer": 1.0,
        "sinistre": 0.9, "couverture": 0.8, "prime d'assurance": 1.1,
        "actuaire": 1.0, "souscription": 0.9,
    },
    SECTOR_FOOD: {
        "food": 0.9, "agri": 1.0, "agriculture": 1.0, "wheat": 1.0, "sugar": 0.9,
        "alimentation": 1.0, "beverage": 0.8, "céréale": 1.0, "soja": 1.0,
        "maïs": 0.9, "café": 0.8, "cacao": 0.9, "fertilizer": 0.9, "engrais": 0.9,
    },
    SECTOR_ENERGY: {
        "oil": 1.0, "pétrole": 1.0, "gas": 0.9, "gaz": 0.9, "opec": 1.2,
        "opep": 1.2, "solar": 1.0, "solaire": 1.0, "wind energy": 1.0,
        "éolien": 1.0, "nuclear": 1.1, "nucléaire": 1.1, "renewable": 1.0,
        "renouvelable": 1.0, "pipeline": 0.8, "barrel": 0.9, "baril": 0.9,
        "lng": 1.0, "hydrogen": 1.2, "hydrogène": 1.2,
    },
    SECTOR_HEALTHCARE: {
        "pharma": 1.1, "biotech": 1.2, "drug": 0.9, "fda": 1.3, "clinical trial": 1.2,
        "essai clinique": 1.2, "vaccine": 1.1, "vaccin": 1.1, "hospital": 0.8,
        "hôpital": 0.8, "medical device": 1.0, "dispositif médical": 1.0,
        "gene therapy": 1.3, "thérapie génique": 1.3, "santé": 0.8,
    },
}

BULLISH_KEYWORDS: dict[str, float] = {
    "upgrade": 1.2, "growth": 1.0, "record": 1.1, "beats": 1.1,
    "partnership": 1.0, "acquisition": 1.1, "hausse": 1.0, "bénéfice": 1.0,
    "rally": 1.2, "breakout": 1.1, "surperform": 1.0, "outperform": 1.0,
    "bullish": 1.3, "dividend": 0.8, "buyback": 0.9, "approval": 1.2,
    "expansion": 0.9, "breakthrough": 1.3, "ipo": 1.0, "merger": 1.1,
    "profit": 0.9, "revenue beat": 1.2, "positive": 0.7, "optimism": 0.8,
}

BEARISH_KEYWORDS: dict[str, float] = {
    "downgrade": 1.2, "lawsuit": 1.1, "fraud": 1.3, "sanction": 1.2,
    "baisse": 1.0, "inflation": 1.1, "rate hike": 1.2, "warning": 1.0,
    "crash": 1.4, "selloff": 1.3, "sell-off": 1.3, "bearish": 1.3,
    "default": 1.2, "bankruptcy": 1.4, "faillite": 1.4, "recall": 1.0,
    "investigation": 1.1, "loss": 0.9, "decline": 1.0, "recession": 1.3,
    "layoff": 1.0, "licenciement": 1.0, "deficit": 1.0, "scandal": 1.2,
}

MACRO_KEYWORDS = frozenset({
    "interest rate", "taux d'intérêt", "inflation", "central bank",
    "banque centrale", "fed", "ecb", "bce", "macro", "gdp", "pib",
    "unemployment", "chômage", "fiscal policy", "monetary policy",
    "politique monétaire", "quantitative easing", "rate hike",
    "rate cut", "treasury", "sovereign debt", "dette souveraine",
})

SOCIAL_MEDIA_KEYWORDS = frozenset({
    "tweet", "post", "influencer", "rumor", "rumeur", "viral",
    "trending", "meme", "reddit", "x.com", "elon musk",
})

# ---------------------------------------------------------------------------
# Confiance par source
# ---------------------------------------------------------------------------

SOURCE_CONFIDENCE: dict[str, Decimal] = {
    "bloomberg_enterprise": Decimal("95.00"),
    "reuters_api": Decimal("93.00"),
    "benzinga": Decimal("88.00"),
    "x_api_v2": Decimal("74.00"),
    "rss_certified": Decimal("80.00"),
    "certified_feed": Decimal("78.00"),
}


# ---------------------------------------------------------------------------
# Dataclasses de résultat
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class NewsAnalysisResult:
    """Sortie standard du pipeline de scoring news."""

    signal_id: uuid.UUID
    mapped_sector: str
    asset_class: str
    retention_category: str
    sentiment_polarity: str
    probability_bullish: Decimal
    probability_bearish: Decimal
    signal_strength: Decimal
    source_confidence: Decimal
    is_valid_signal: bool
    time_to_live_minutes: int
    expires_at: datetime
    keywords_matched: dict[str, list[str]]


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
    recommended_capital: Decimal | None = None
    estimated_duration_minutes: int | None = None
    planned_close_at: datetime | None = None
    active_trade_id: uuid.UUID | None = None


@dataclass(slots=True)
class CycleClosureResult:
    """Résultat de clôture d'une position arrivée à expiration."""

    trade_id: uuid.UUID
    user_id: uuid.UUID
    sector: str
    direction: str
    capital_returned: Decimal
    simulated_pnl: Decimal
    pnl_pct: Decimal
    close_reason: str
    message: str


@dataclass(slots=True)
class ClosureReport:
    """Rapport agrégé des clôtures de cycle."""

    closed_count: int
    total_pnl: Decimal
    closures: list[CycleClosureResult] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Fonctions utilitaires internes
# ---------------------------------------------------------------------------

def _quantize(value: Decimal, precision: str = "0.01") -> Decimal:
    return value.quantize(Decimal(precision), rounding=ROUND_HALF_UP)


def _clamp(value: Decimal, minimum: Decimal, maximum: Decimal) -> Decimal:
    return max(minimum, min(value, maximum))


def _deterministic_noise(news_text: str, category: str) -> Decimal:
    """Bruit déterministe basé sur le hash du contenu, intervalle [-6, +6]."""
    digest = hashlib.sha256(f"{category}:{news_text.lower()}".encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    return Decimal((seed % 1201) - 600) / Decimal("100")


def _extract_source(category: str) -> str:
    """Déduit la source d'ingestion depuis la catégorie fournie."""
    lowered = category.lower()
    source_map = [
        ("bloomberg", "bloomberg_enterprise"),
        ("reuters", "reuters_api"),
        ("benzinga", "benzinga"),
        ("twitter", "x_api_v2"),
        ("x_api", "x_api_v2"),
        ("rss", "rss_certified"),
    ]
    for keyword, source_name in source_map:
        if keyword in lowered:
            return source_name
    return "certified_feed"


def _get_source_confidence(source: str) -> Decimal:
    return SOURCE_CONFIDENCE.get(source, Decimal("78.00"))


# ---------------------------------------------------------------------------
# Mapping sectoriel pondéré
# ---------------------------------------------------------------------------

def _map_sector_weighted(news_text: str) -> tuple[str, dict[str, list[str]]]:
    """Identifie le secteur dominant par scoring pondéré des mots-clés.

    Retourne le secteur avec le score le plus élevé et la liste des
    mots-clés effectivement détectés par secteur.
    """
    lowered = news_text.lower()
    sector_scores: dict[str, float] = {}
    matched_keywords: dict[str, list[str]] = {}

    for sector, keywords in SECTOR_KEYWORDS.items():
        score = 0.0
        hits: list[str] = []
        for keyword, weight in keywords.items():
            if len(keyword) <= 3:
                if re.search(r'\b' + re.escape(keyword) + r'\b', lowered):
                    score += weight
                    hits.append(keyword)
            elif keyword in lowered:
                score += weight
                hits.append(keyword)
        if score > 0:
            sector_scores[sector] = score
            matched_keywords[sector] = hits

    if not sector_scores:
        return SECTOR_GENERAL, {}

    best_sector = max(sector_scores, key=sector_scores.get)  # type: ignore[arg-type]
    return best_sector, matched_keywords


# ---------------------------------------------------------------------------
# Classification de rétention temporelle
# ---------------------------------------------------------------------------

def _classify_retention(news_text: str) -> str:
    """Classe la news en macro / corporate / social_media."""
    lowered = news_text.lower()
    if any(kw in lowered for kw in MACRO_KEYWORDS):
        return "macro"
    if any(kw in lowered for kw in SOCIAL_MEDIA_KEYWORDS):
        return "social_media"
    return "corporate"


# ---------------------------------------------------------------------------
# Résolution classe d'actif
# ---------------------------------------------------------------------------

def _resolve_asset_class(category: str) -> str:
    lowered = category.lower()
    if any(token in lowered for token in ("crypto", "binance", "coinbase", "bitcoin", "btc", "eth")):
        return ASSET_CRYPTO
    if "etf" in lowered:
        return ASSET_ETF
    return ASSET_STOCK


# ---------------------------------------------------------------------------
# Calcul de probabilité haussière / baissière
# ---------------------------------------------------------------------------

def _compute_probabilities(
    news_text: str,
    category: str,
    source_conf: Decimal,
) -> tuple[str, Decimal, Decimal, Decimal]:
    """Calcule la polarité et les probabilités haussière/baissière.

    Le scoring utilise :
    - Un score de base (58%)
    - Les hits pondérés sur les dictionnaires haussiers/baissiers
    - Un bonus dépendant de la confiance de la source
    - Un bonus par classe d'actif (crypto/stock > ETF)
    - Un bruit déterministe pour la reproductibilité

    Retourne (polarity, prob_bullish, prob_bearish, signal_strength).
    """
    lowered = news_text.lower()

    bullish_score = sum(
        weight for keyword, weight in BULLISH_KEYWORDS.items()
        if keyword in lowered
    )
    bearish_score = sum(
        weight for keyword, weight in BEARISH_KEYWORDS.items()
        if keyword in lowered
    )

    base = Decimal("58.00")
    source_bonus = (source_conf - Decimal("70.00")) / Decimal("6.0")
    asset_class = _resolve_asset_class(category)
    category_bonus = Decimal("3.00") if asset_class in {ASSET_CRYPTO, ASSET_STOCK} else Decimal("1.50")
    total_hits = Decimal(str(bullish_score + bearish_score))
    noise = _deterministic_noise(news_text, category)

    raw_score = base + (Decimal("7.00") * total_hits) + source_bonus + category_bonus + noise
    strength = _quantize(_clamp(raw_score, Decimal("50.00"), Decimal("99.00")))

    if bullish_score > bearish_score:
        prob_bullish = strength
        prob_bearish = _quantize(Decimal("100.00") - strength)
        return "positive", prob_bullish, prob_bearish, strength

    if bearish_score > bullish_score:
        prob_bearish = strength
        prob_bullish = _quantize(Decimal("100.00") - strength)
        return "negative", prob_bullish, prob_bearish, strength

    neutral = _quantize(_clamp(
        Decimal("52.00") + noise,
        Decimal("45.00"),
        Decimal("65.00"),
    ))
    opposite = _quantize(Decimal("100.00") - neutral)
    return "neutral", neutral, opposite, _quantize(max(neutral, opposite))


# ---------------------------------------------------------------------------
# Estimation du TTL (Time-To-Live)
# ---------------------------------------------------------------------------

def _estimate_ttl_minutes(
    news_text: str,
    category: str,
    mapped_sector: str,
    retention_category: str,
    strength: Decimal,
) -> int:
    """Estime la durée de rétention de l'impact de la news.

    Logique à trois niveaux :
    - **macro** (taux d'intérêt, PIB, banque centrale) → 3-7 jours
    - **social_media** (tweet, influenceur, rumeur) → 30-120 minutes
    - **corporate** (défaut) → dépend du secteur (4h–18h)
    """
    if retention_category == "macro":
        base_ttl = 60 * 24 * 3
    elif retention_category == "social_media":
        base_ttl = 45
    elif mapped_sector == SECTOR_MINES:
        base_ttl = 60 * 18
    elif mapped_sector == SECTOR_ENERGY:
        base_ttl = 60 * 16
    elif mapped_sector == SECTOR_TECH:
        base_ttl = 60 * 8
    elif mapped_sector == SECTOR_HEALTHCARE:
        base_ttl = 60 * 12
    elif _resolve_asset_class(category) == ASSET_CRYPTO:
        base_ttl = 60 * 4
    else:
        base_ttl = 60 * 6

    confidence_multiplier = Decimal("1.0") + ((strength - Decimal("70.00")) / Decimal("100.0"))
    ttl = int(Decimal(base_ttl) * confidence_multiplier)
    return max(30, min(ttl, 60 * 24 * 7))


# ---------------------------------------------------------------------------
# Vérification des filtres sectoriels
# ---------------------------------------------------------------------------

_SECTOR_ATTRIBUTE_MAP: dict[str, str] = {
    SECTOR_TECH: "sector_tech",
    SECTOR_MINES: "sector_mines",
    SECTOR_REAL_ESTATE: "sector_real_estate",
    SECTOR_INSURANCE: "sector_insurance",
    SECTOR_FOOD: "sector_food",
    SECTOR_ENERGY: "sector_energy",
    SECTOR_HEALTHCARE: "sector_healthcare",
}


def _is_sector_enabled(preference: UserPreference, sector: str) -> bool:
    attr = _SECTOR_ATTRIBUTE_MAP.get(sector)
    if attr is None:
        return True
    return bool(getattr(preference, attr, True))


def _is_asset_class_enabled(preference: UserPreference, asset_class: str) -> bool:
    if asset_class == ASSET_CRYPTO:
        return preference.enable_crypto
    if asset_class == ASSET_ETF:
        return preference.enable_etf
    return preference.enable_stocks


# ---------------------------------------------------------------------------
# Création de préférences par défaut
# ---------------------------------------------------------------------------

def _default_preferences(user_id: uuid.UUID) -> UserPreference:
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
        sector_healthcare=False,
        max_capital_per_trade_pct=Decimal("20.00"),
        max_concurrent_positions=5,
        preferred_trade_duration="medium",
    )


# ---------------------------------------------------------------------------
# Scoring composite pour le tri des signaux
# ---------------------------------------------------------------------------

def _composite_score(signal: MarketSignal, now: datetime) -> Decimal:
    """Score composite = strength × source_confidence × recency_decay.

    Le facteur de décroissance temporelle pénalise les signaux anciens
    pour privilégier les informations fraîches.
    """
    age_minutes = max(1, (now - signal.created_at).total_seconds() / 60.0)
    half_life = float(signal.time_to_live_minutes) / 2.0
    recency_decay = Decimal(str(max(0.30, 1.0 / (1.0 + age_minutes / half_life))))
    return _quantize(
        signal.signal_strength
        * (signal.source_confidence / Decimal("100.00"))
        * recency_decay
    )


# ---------------------------------------------------------------------------
# Simulation de prix d'entrée (déterministe)
# ---------------------------------------------------------------------------

def _simulate_entry_price(signal: MarketSignal) -> Decimal:
    """Génère un prix d'entrée simulé basé sur le hash du signal."""
    digest = hashlib.sha256(str(signal.id).encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)
    base = Decimal("50.00") + Decimal(seed % 950) / Decimal("10")
    return _quantize(base, "0.0001")


# ---------------------------------------------------------------------------
# Fonction publique n°1 : analyse d'une news entrante
# ---------------------------------------------------------------------------

async def analyze_incoming_news(news_text: str, category: str) -> NewsAnalysisResult:
    """Analyse une news entrante, calcule probabilités et persiste le signal.

    Pipeline :
    1. Validation des entrées
    2. Identification de la source et de sa confiance
    3. Mapping sectoriel pondéré
    4. Classification de rétention temporelle (macro/corporate/social)
    5. Calcul des probabilités haussière/baissière
    6. Estimation du TTL
    7. Persistance en base du MarketSignal
    """
    if not news_text or not news_text.strip():
        raise ValueError("news_text doit contenir du texte.")
    if not category or not category.strip():
        raise ValueError("category doit être renseignée.")

    news_text = news_text.strip()
    category = category.strip().lower()

    source = _extract_source(category)
    source_conf = _get_source_confidence(source)
    mapped_sector, keywords_matched = _map_sector_weighted(news_text)
    asset_class = _resolve_asset_class(category)
    retention_category = _classify_retention(news_text)

    polarity, bullish, bearish, strength = _compute_probabilities(
        news_text, category, source_conf,
    )
    is_valid = strength >= MIN_SIGNAL_PROBABILITY
    ttl_minutes = _estimate_ttl_minutes(
        news_text, category, mapped_sector, retention_category, strength,
    )
    expires_at = datetime.now(UTC) + timedelta(minutes=ttl_minutes)

    signal = MarketSignal(
        source=source,
        category=category,
        news_text=news_text,
        mapped_sector=mapped_sector,
        asset_class=asset_class,
        retention_category=retention_category,
        sentiment_polarity=polarity,
        source_confidence=source_conf,
        probability_bullish=bullish,
        probability_bearish=bearish,
        signal_strength=strength,
        is_valid_signal=is_valid,
        time_to_live_minutes=ttl_minutes,
        expires_at=expires_at,
        keywords_matched=keywords_matched,
        metadata_json={
            "pipeline_version": "v2.0",
            "asset_class": asset_class,
            "retention_category": retention_category,
        },
    )

    async with AsyncSessionLocal() as session:
        session.add(signal)
        await session.commit()
        await session.refresh(signal)

    logger.info(
        "Signal %s créé: secteur=%s, polarité=%s, force=%s, valide=%s, TTL=%dmin",
        signal.id, mapped_sector, polarity, strength, is_valid, ttl_minutes,
    )

    return NewsAnalysisResult(
        signal_id=signal.id,
        mapped_sector=signal.mapped_sector,
        asset_class=asset_class,
        retention_category=retention_category,
        sentiment_polarity=signal.sentiment_polarity,
        probability_bullish=signal.probability_bullish,
        probability_bearish=signal.probability_bearish,
        signal_strength=signal.signal_strength,
        source_confidence=source_conf,
        is_valid_signal=signal.is_valid_signal,
        time_to_live_minutes=signal.time_to_live_minutes,
        expires_at=signal.expires_at,
        keywords_matched=keywords_matched,
    )


# ---------------------------------------------------------------------------
# Fonction publique n°2 : évaluation d'opportunité de trading
# ---------------------------------------------------------------------------

async def evaluate_trading_opportunity(user_id: uuid.UUID) -> TradingOpportunityResult:
    """Croise préférences utilisateur et signaux valides pour décider d'un trade.

    Étapes :
    1. Validation utilisateur et wallet
    2. Chargement ou création des préférences
    3. Récupération des signaux valides non expirés
    4. Filtrage par classes d'actifs et secteurs activés
    5. Tri par score composite (strength × source_conf × recency)
    6. Vérification des limites de positions concurrentes
    7. Calcul du capital recommandé (plafonné par max_capital_per_trade_pct)
    8. Déduction du capital du wallet et ouverture de la position
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
            select(UserPreference).where(UserPreference.user_id == user_id),
        )
        if preference is None:
            preference = _default_preferences(user_id)
            session.add(preference)
            await session.flush()

        threshold = _quantize(max(
            preference.minimum_probability_threshold,
            MIN_SIGNAL_PROBABILITY,
        ))

        # --- Signaux valides et non expirés ---
        cutoff = now - timedelta(hours=MAX_SIGNAL_AGE_HOURS)
        recent_signals = (
            await session.execute(
                select(MarketSignal)
                .where(
                    MarketSignal.is_valid_signal.is_(True),
                    MarketSignal.expires_at > now,
                    MarketSignal.created_at >= cutoff,
                )
                .order_by(desc(MarketSignal.signal_strength), desc(MarketSignal.created_at))
                .limit(100)
            )
        ).scalars().all()

        if not recent_signals:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Aucun signal valide récent.",
                user_id=user_id,
            )

        # --- Filtrage par préférences ---
        eligible_signals: list[tuple[MarketSignal, Decimal]] = []
        for signal in recent_signals:
            asset_class = signal.asset_class or _resolve_asset_class(signal.category)
            if not _is_asset_class_enabled(preference, asset_class):
                continue
            if not _is_sector_enabled(preference, signal.mapped_sector):
                continue
            if signal.signal_strength < threshold:
                continue
            composite = _composite_score(signal, now)
            eligible_signals.append((signal, composite))

        if not eligible_signals:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Signaux non alignés avec les préférences utilisateur.",
                user_id=user_id,
            )

        eligible_signals.sort(key=lambda pair: pair[1], reverse=True)

        # --- Vérification positions concurrentes ---
        open_positions_count = (
            await session.execute(
                select(ActiveTrade.id).where(
                    ActiveTrade.user_id == user_id,
                    ActiveTrade.status == "open",
                )
            )
        ).scalars().all()

        if len(open_positions_count) >= preference.max_concurrent_positions:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason=(
                    f"Limite de positions concurrentes atteinte "
                    f"({preference.max_concurrent_positions})."
                ),
                user_id=user_id,
            )

        # --- Sélection du meilleur signal non déjà exploité ---
        selected_signal: MarketSignal | None = None
        for signal, _ in eligible_signals:
            existing = await session.scalar(
                select(ActiveTrade.id).where(
                    ActiveTrade.user_id == user_id,
                    ActiveTrade.market_signal_id == signal.id,
                    ActiveTrade.status == "open",
                )
            )
            if existing is None:
                selected_signal = signal
                break

        if selected_signal is None:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Tous les signaux éligibles sont déjà exploités.",
                user_id=user_id,
            )

        # --- Calcul du capital recommandé ---
        max_trade_amount = _quantize(
            wallet.solde_disponible * preference.max_capital_per_trade_pct / Decimal("100.00"),
        )
        recommended_capital = _quantize(
            min(wallet.solde_disponible, max(MIN_RECOMMENDED_CAPITAL, max_trade_amount)),
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
        entry_price = _simulate_entry_price(selected_signal)

        # --- Déduction du capital du wallet ---
        wallet.solde_disponible -= recommended_capital
        wallet.solde_engage += recommended_capital

        active_trade = ActiveTrade(
            user_id=user_id,
            market_signal_id=selected_signal.id,
            asset_class=selected_signal.asset_class or _resolve_asset_class(selected_signal.category),
            sector=selected_signal.mapped_sector,
            direction=direction,
            probability_used=selected_signal.signal_strength,
            capital_engaged=recommended_capital,
            entry_price_simulated=entry_price,
            status="open",
            estimated_duration_minutes=estimated_duration,
            planned_close_at=planned_close,
        )
        session.add(active_trade)
        await session.commit()
        await session.refresh(active_trade)

    logger.info(
        "Trade %s ouvert pour user=%s: signal=%s, direction=%s, capital=%s, durée=%dmin",
        active_trade.id, user_id, selected_signal.id, direction,
        recommended_capital, estimated_duration,
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


# ---------------------------------------------------------------------------
# Fonction publique n°3 : clôture des positions expirées
# ---------------------------------------------------------------------------

def _simulate_exit_pnl(
    trade: ActiveTrade,
    signal: MarketSignal | None,
) -> tuple[Decimal, Decimal]:
    """Simule un prix de sortie et le PnL en fonction de la probabilité utilisée.

    La simulation est déterministe (basée sur le hash de l'ID du trade) pour
    la reproductibilité.  Le PnL moyen est positivement corrélé à la
    force du signal d'origine.
    """
    digest = hashlib.sha256(str(trade.id).encode("utf-8")).hexdigest()
    seed = int(digest[:8], 16)

    strength_float = float(trade.probability_used)
    win_probability = min(0.85, strength_float / 120.0)
    is_win = (seed % 100) < int(win_probability * 100)

    pnl_range_pct = (seed % 800 + 50) / 10000.0
    if is_win:
        pnl_pct = Decimal(str(pnl_range_pct))
    else:
        pnl_pct = Decimal(str(-pnl_range_pct * 0.6))

    pnl = _quantize(trade.capital_engaged * pnl_pct)
    entry = trade.entry_price_simulated or Decimal("100.0000")
    if trade.direction == "buy":
        exit_price = _quantize(entry * (Decimal("1") + pnl_pct), "0.0001")
    else:
        exit_price = _quantize(entry * (Decimal("1") - pnl_pct), "0.0001")

    return exit_price, pnl


async def close_expired_positions() -> ClosureReport:
    """Clôture toutes les positions dont l'horizon de temps est dépassé.

    Pour chaque position expirée :
    1. Calcule un PnL simulé
    2. Met à jour le statut → 'closed'
    3. Recrédite le wallet (capital + PnL)
    4. Génère un message de fin de cycle
    """
    now = datetime.now(UTC)
    report = ClosureReport(closed_count=0, total_pnl=Decimal("0.00"))

    async with AsyncSessionLocal() as session:
        expired_trades = (
            await session.execute(
                select(ActiveTrade)
                .where(
                    ActiveTrade.status == "open",
                    ActiveTrade.planned_close_at <= now,
                )
                .order_by(ActiveTrade.planned_close_at)
            )
        ).scalars().all()

        if not expired_trades:
            return report

        for trade in expired_trades:
            signal = None
            if trade.market_signal_id is not None:
                signal = await session.get(MarketSignal, trade.market_signal_id)

            exit_price, pnl = _simulate_exit_pnl(trade, signal)

            trade.exit_price_simulated = exit_price
            trade.simulated_pnl = pnl
            trade.status = "closed"
            trade.closed_at = now
            trade.close_reason = "Horizon de temps atteint — cycle automatique."

            wallet = await session.scalar(
                select(Wallet).where(Wallet.user_id == trade.user_id),
            )
            if wallet is not None:
                returned = trade.capital_engaged + pnl
                wallet.solde_engage -= trade.capital_engaged
                wallet.solde_disponible += returned
                wallet.solde_total += pnl
            else:
                returned = trade.capital_engaged

            pnl_pct = _quantize(
                (pnl / trade.capital_engaged * Decimal("100.00"))
                if trade.capital_engaged > 0
                else Decimal("0.00"),
            )

            message = (
                f"Cycle terminé. Profit : {'+' if pnl >= 0 else ''}{pnl_pct}%. "
                f"Souhaitez-vous relancer le capital sur une nouvelle opportunité ?"
            )

            closure = CycleClosureResult(
                trade_id=trade.id,
                user_id=trade.user_id,
                sector=trade.sector,
                direction=trade.direction,
                capital_returned=returned,
                simulated_pnl=pnl,
                pnl_pct=pnl_pct,
                close_reason=trade.close_reason,
                message=message,
            )
            report.closures.append(closure)
            report.total_pnl += pnl
            report.closed_count += 1

            logger.info(
                "Trade %s clôturé: PnL=%s (%s%%), capital rendu=%s",
                trade.id, pnl, pnl_pct, returned,
            )

        await session.commit()

    return report
