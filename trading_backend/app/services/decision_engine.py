"""Moteur NLP + décision trading basé sur les préférences utilisateur.

Pipeline de traitement :
  1. ``analyze_incoming_news`` : scoring NLP déterministe, mapping sectoriel,
     calcul de probabilité haussière/baissière et TTL dynamique.
  2. ``evaluate_trading_opportunity`` : croise les signaux valides avec les
     préférences de l'utilisateur et ouvre une ``ActiveTrade`` si pertinent.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import desc, select

from app.db.database import AsyncSessionLocal
from app.models.active_trade import ActiveTrade
from app.models.market_signal import MarketSignal
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet

# ---------------------------------------------------------------------------
# Constantes secteur / classe d'actif
# ---------------------------------------------------------------------------

SECTOR_TECH = "tech"
SECTOR_MINES = "mines"
SECTOR_REAL_ESTATE = "real_estate"
SECTOR_INSURANCE = "insurance"
SECTOR_FOOD = "food"
SECTOR_ENERGY = "energy"
SECTOR_FINANCE = "finance"
SECTOR_GENERAL = "general"

ASSET_CRYPTO = "crypto"
ASSET_ETF = "etf"
ASSET_STOCK = "stocks"

MIN_SIGNAL_PROBABILITY = Decimal("70.00")
MIN_RECOMMENDED_CAPITAL = Decimal("50.00")

# ---------------------------------------------------------------------------
# Mapping sectoriel
#
# Deux catégories de mots-clés par secteur :
#   WORD  → correspondance exacte sur les tokens (mots entiers).
#           Évite les faux positifs : "or" (fr. gold) ne matche pas "record".
#   PHRASE → correspondance de sous-chaîne pour les expressions multi-mots.
# ---------------------------------------------------------------------------

_SECTOR_WORD_KW: dict[str, frozenset[str]] = {
    SECTOR_MINES: frozenset({
        # Métaux précieux
        "gold", "silver", "platinum", "palladium",
        # Métaux industriels / batteries
        "lithium", "cobalt", "nickel", "copper", "zinc", "uranium",
        "tungsten", "manganese",
        # Secteur minier
        "mine", "mining", "minier", "minière", "drill", "forage",
        "minerai", "gisement", "extraction",
        # Grandes minières
        "barrick", "bhp", "vale", "freeport", "agnico", "newmont",
        # Français non-ambigu (token entier uniquement)
        "cuivre", "platine", "or",
    }),
    SECTOR_TECH: frozenset({
        # Semi-conducteurs
        "nvidia", "amd", "intel", "tsmc", "qualcomm", "arm",
        "semiconductor", "chip", "wafer", "puce",
        # IA & cloud
        "llm", "gpt", "openai", "anthropic", "gemini",
        "cloud", "saas", "paas", "hyperscaler", "datacentre",
        # Logiciel & cybersécurité
        "software", "logiciel", "cyber", "cybersecurity", "ransomware",
        # GAFAM + grandes tech
        "apple", "microsoft", "google", "alphabet", "meta",
        "amazon", "tesla", "netflix", "salesforce", "oracle", "sap",
        # Générique tech
        "technology", "technologie", "startup", "innovation",
        # Acronymes tech (token entier seulement)
        "ai", "ia", "nlp",
    }),
    SECTOR_ENERGY: frozenset({
        "oil", "crude", "brent", "wti", "opec", "opep",
        "lng", "gnl",
        "solar", "solaire", "wind", "éolien", "renewable", "renouvelable",
        "nuclear", "nucléaire", "hydrogen", "hydrogène",
        "exxon", "chevron", "shell", "totalenergies",
        "energy", "énergie", "pétrole",
    }),
    SECTOR_REAL_ESTATE: frozenset({
        "reit", "foncière", "immobilier",
        "housing", "logement", "mortgage", "hypothèque",
        "apartment", "appartement", "property",
        "blackstone", "prologis", "vonovia",
    }),
    SECTOR_INSURANCE: frozenset({
        "insurance", "assurance", "reinsurance", "réassurance",
        "underwriting", "sinistre", "actuarial", "actuaire",
        "axa", "allianz", "aig", "berkshire", "zurich", "scor",
        "covéa", "generali",
    }),
    SECTOR_FOOD: frozenset({
        "food", "alimentation", "agriculture", "agribusiness",
        "wheat", "blé", "corn", "maïs", "soy", "soja", "sugar", "sucre",
        "coffee", "café", "cocoa", "cacao", "rice", "riz",
        "beverage", "boisson", "restaurant",
        "nestle", "unilever", "danone", "kraft", "mondelez",
    }),
    SECTOR_FINANCE: frozenset({
        "bank", "banque", "banking", "credit", "crédit", "loan", "prêt",
        "fed", "ecb", "bce", "boj",
        "goldman", "jpmorgan", "barclays", "hsbc", "bnp",
        "fintech", "payment", "paiement", "visa", "mastercard", "stripe",
    }),
}

_SECTOR_PHRASE_KW: dict[str, frozenset[str]] = {
    SECTOR_MINES: frozenset({
        "rare earth", "terres rares", "rio tinto",
        "precious metal", "base metal", "or physique",
    }),
    SECTOR_TECH: frozenset({
        "artificial intelligence", "machine learning", "deep learning",
        "semi-conducteur", "ipo tech",
    }),
    SECTOR_ENERGY: frozenset({
        "natural gas", "gaz naturel", "power grid", "réseau électrique",
        "oil price", "crude oil",
    }),
    SECTOR_REAL_ESTATE: frozenset({
        "real estate", "commercial real estate", "taux immobilier",
        "simon property",
    }),
    SECTOR_INSURANCE: frozenset({
        "munich re",
    }),
    SECTOR_FOOD: frozenset({
        "consumer staples", "biens de consommation courante",
    }),
    SECTOR_FINANCE: frozenset({
        "interest rate", "taux d'intérêt", "central bank", "banque centrale",
        "monetary policy", "politique monétaire", "hedge fund", "private equity",
        "credit suisse", "deutsche bank", "morgan stanley", "société générale",
        "rate hike", "rate cut", "taux directeur",
    }),
}

# ---------------------------------------------------------------------------
# Mots-clés de sentiment haussier / baissier
# ---------------------------------------------------------------------------

_BULLISH_WORD_KW: frozenset[str] = frozenset({
    "upgrade", "upgraded", "beats", "surpasses", "outperform",
    "growth", "record", "surge", "soar", "rally",
    "acquisition", "merger", "partnership", "approval",
    "dividend", "buyback", "launch",
    "profit", "beat", "raised", "breakthrough",
    "hausse", "bénéfice", "partenariat", "lancement",
})

_BEARISH_WORD_KW: frozenset[str] = frozenset({
    "downgrade", "downgraded", "miss", "misses", "underperform",
    "loss", "lawsuit", "fraud", "sanction", "fine", "ban",
    "inflation", "recession", "layoff", "bankruptcy", "default",
    "warning", "slowdown", "contraction", "recall",
    "baisse", "perte", "déficit", "licenciement", "faillite",
})

_BULLISH_PHRASE_KW: frozenset[str] = frozenset({
    "rate hike reversed", "guidance raised", "eps beat",
    "all-time high", "record high",
})

_BEARISH_PHRASE_KW: frozenset[str] = frozenset({
    "rate hike", "interest rate hike", "credit crunch",
    "margin call", "going bankrupt", "chapter 11",
})

# ---------------------------------------------------------------------------
# Sources certifiées & indice de confiance
# ---------------------------------------------------------------------------

_SOURCE_CONFIDENCE: dict[str, Decimal] = {
    "bloomberg_enterprise": Decimal("96.00"),
    "reuters_api":          Decimal("94.00"),
    "benzinga":             Decimal("88.00"),
    "x_api_v2":             Decimal("72.00"),
    "rss_certified":        Decimal("81.00"),
    "certified_feed":       Decimal("78.00"),
}

# Durées TTL (minutes) par type de news : (ttl_min, ttl_max)
_TTL_RANGES: dict[str, tuple[int, int]] = {
    "macro":    (60 * 24 * 3,  60 * 24 * 21),
    "policy":   (60 * 24 * 2,  60 * 24 * 14),
    "earnings": (60 * 18,      60 * 72),
    "merger":   (60 * 24,      60 * 24 * 7),
    "analyst":  (60 * 12,      60 * 48),
    "breaking": (60 * 2,       60 * 12),
    "tweet":    (30,            60 * 4),
    "crypto":   (60,            60 * 8),
    "mines":    (60 * 12,      60 * 36),
    "tech":     (60 * 6,       60 * 24),
    "energy":   (60 * 8,       60 * 36),
    "default":  (60 * 4,       60 * 24),
}

# ---------------------------------------------------------------------------
# Dataclasses résultats
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


# ---------------------------------------------------------------------------
# Helpers internes
# ---------------------------------------------------------------------------

def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _clamp(value: Decimal, lo: Decimal, hi: Decimal) -> Decimal:
    return max(lo, min(value, hi))


def _deterministic_noise(text: str, category: str) -> Decimal:
    """Bruit déterministe borné à ±6.00, dérivé du hash du contenu."""
    digest = hashlib.sha256(f"{category}:{text.lower()}".encode()).hexdigest()
    seed = int(digest[:8], 16)
    return Decimal((seed % 1201) - 600) / Decimal("100")


def _tokenize(text: str) -> frozenset[str]:
    """Découpe un texte en tokens minuscules (alphanumérique + apostrophes)."""
    return frozenset(re.findall(r"[a-záàâäéèêëíìîïóòôöúùûüçñ']+", text.lower()))


def _has_word_keyword(tokens: frozenset[str], keywords: frozenset[str]) -> bool:
    return bool(tokens & keywords)


def _has_phrase_keyword(lc_text: str, phrases: frozenset[str]) -> bool:
    return any(phrase in lc_text for phrase in phrases)


def _extract_source(category: str) -> str:
    lc = category.lower()
    if "bloomberg" in lc:
        return "bloomberg_enterprise"
    if "reuters" in lc:
        return "reuters_api"
    if "benzinga" in lc:
        return "benzinga"
    if "x" in lc.split("_") or "twitter" in lc:
        return "x_api_v2"
    if "rss" in lc:
        return "rss_certified"
    return "certified_feed"


def _source_confidence(source: str) -> Decimal:
    return _SOURCE_CONFIDENCE.get(source, Decimal("78.00"))


# ---------------------------------------------------------------------------
# Fonctions publiques du moteur
# ---------------------------------------------------------------------------

def map_sector(news_text: str) -> str:
    """Mappe un texte de news vers un secteur économique.

    Utilise une correspondance exacte sur les tokens (mots entiers) pour les
    mots-clés courts ambigus, et une correspondance de sous-chaîne pour les
    expressions multi-mots.  Ordre de priorité décroissante défini dans la
    liste ``priority``.
    """
    lc = news_text.lower()
    tokens = _tokenize(lc)
    priority = [
        SECTOR_FINANCE, SECTOR_TECH, SECTOR_ENERGY, SECTOR_MINES,
        SECTOR_REAL_ESTATE, SECTOR_INSURANCE, SECTOR_FOOD,
    ]
    for sector in priority:
        if _has_word_keyword(tokens, _SECTOR_WORD_KW[sector]):
            return sector
        if _has_phrase_keyword(lc, _SECTOR_PHRASE_KW.get(sector, frozenset())):
            return sector
    return SECTOR_GENERAL


def _resolve_asset_class(category: str) -> str:
    lc = category.lower()
    if any(kw in lc for kw in ("crypto", "bitcoin", "ethereum", "binance", "coinbase")):
        return ASSET_CRYPTO
    if "etf" in lc:
        return ASSET_ETF
    return ASSET_STOCK


def _compute_probabilities(
    news_text: str,
    category: str,
    source_conf: Decimal,
) -> tuple[str, Decimal, Decimal]:
    """Calcule les probabilités haussière et baissière d'une news.

    Formule :
        score = 58 + 8.5*(hits_total) + source_bonus + class_bonus + noise
    clampé à [50, 99], attribué à la polarité dominante.
    La polarité opposée = 100 - score.
    """
    lc = news_text.lower()
    tokens = _tokenize(lc)

    bullish_hits = (
        sum(1 for kw in _BULLISH_WORD_KW if kw in tokens)
        + sum(1 for ph in _BULLISH_PHRASE_KW if ph in lc)
    )
    bearish_hits = (
        sum(1 for kw in _BEARISH_WORD_KW if kw in tokens)
        + sum(1 for ph in _BEARISH_PHRASE_KW if ph in lc)
    )

    base = Decimal("58.00")
    source_bonus = (source_conf - Decimal("70.00")) / Decimal("6.0")
    class_bonus = (
        Decimal("3.50")
        if _resolve_asset_class(category) in {ASSET_CRYPTO, ASSET_STOCK}
        else Decimal("1.50")
    )
    raw_score = (
        base
        + Decimal("8.50") * Decimal(bullish_hits + bearish_hits)
        + source_bonus
        + class_bonus
        + _deterministic_noise(news_text, category)
    )
    strength = _quantize(_clamp(raw_score, Decimal("50.00"), Decimal("99.00")))

    if bullish_hits > bearish_hits:
        return ("positive", strength, _quantize(Decimal("100.00") - strength))
    if bearish_hits > bullish_hits:
        return ("negative", _quantize(Decimal("100.00") - strength), strength)

    neutral = _quantize(
        _clamp(
            Decimal("52.00") + _deterministic_noise(news_text, category),
            Decimal("45.00"),
            Decimal("65.00"),
        )
    )
    return ("neutral", neutral, _quantize(Decimal("100.00") - neutral))


def _estimate_ttl_minutes(
    news_text: str,
    category: str,
    mapped_sector: str,
    strength: Decimal,
) -> int:
    """Durée de rétention (TTL) dynamique d'un signal.

    Logique par priorité :
      1. Mots-clés macro-économiques (taux, banque centrale) → TTL long
      2. Réseaux sociaux / rumeurs → TTL court
      3. Secteur mappé → plage sectorielle
      4. Classe d'actif (crypto)
      5. Défaut générique
    Le TTL est interpolé linéairement selon la force du signal.
    """
    lc = news_text.lower()
    tokens = _tokenize(lc)

    if any(ph in lc for ph in (
        "interest rate", "taux directeur", "central bank", "banque centrale",
        "monetary policy", "politique monétaire", "rate decision",
    )) or any(w in tokens for w in ("inflation", "recession", "récession", "fed", "ecb", "bce", "macro")):
        ttl_key = "macro"
    elif any(ph in lc for ph in ("monetary policy", "rate decision")):
        ttl_key = "policy"
    elif any(w in tokens for w in ("earnings", "résultats", "guidance")) or "quarterly" in lc:
        ttl_key = "earnings"
    elif any(w in tokens for w in ("merger", "acquisition", "takeover", "rachat")) or "m&a" in lc:
        ttl_key = "merger"
    elif any(w in tokens for w in ("analyst", "analyste")) or any(
        ph in lc for ph in ("price target", "downgrade", "upgrade")
    ):
        ttl_key = "analyst"
    elif any(w in tokens for w in ("breaking", "flash", "alert", "urgent")):
        ttl_key = "breaking"
    elif any(w in tokens for w in ("tweet", "influencer", "rumor", "rumeur")) or "x.com" in lc:
        ttl_key = "tweet"
    elif _resolve_asset_class(category) == ASSET_CRYPTO:
        ttl_key = "crypto"
    elif mapped_sector == SECTOR_MINES:
        ttl_key = "mines"
    elif mapped_sector == SECTOR_TECH:
        ttl_key = "tech"
    elif mapped_sector == SECTOR_ENERGY:
        ttl_key = "energy"
    else:
        ttl_key = "default"

    ttl_min, ttl_max = _TTL_RANGES[ttl_key]
    normalized = _clamp(
        (strength - Decimal("70.00")) / Decimal("29.00"),
        Decimal("0.00"),
        Decimal("1.00"),
    )
    ttl = ttl_min + int(Decimal(ttl_max - ttl_min) * normalized)
    return max(30, min(ttl, 60 * 24 * 21))


def _is_sector_enabled(preference: UserPreference, sector: str) -> bool:
    mapping = {
        SECTOR_TECH:        preference.sector_tech,
        SECTOR_MINES:       preference.sector_mines,
        SECTOR_REAL_ESTATE: preference.sector_real_estate,
        SECTOR_INSURANCE:   preference.sector_insurance,
        SECTOR_FOOD:        preference.sector_food,
    }
    return mapping.get(sector, True)


def _is_asset_class_enabled(preference: UserPreference, asset_class: str) -> bool:
    mapping = {
        ASSET_CRYPTO: preference.enable_crypto,
        ASSET_ETF:    preference.enable_etf,
        ASSET_STOCK:  preference.enable_stocks,
    }
    return mapping.get(asset_class, True)


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
    )


async def analyze_incoming_news(news_text: str, category: str) -> NewsAnalysisResult:
    """Analyse une news entrante, calcule les probabilités et persiste le signal.

    Args:
        news_text: Corps de la dépêche ou du tweet à scorer.
        category:  Catégorie / source (ex : "reuters_api", "crypto", "bloomberg").

    Returns:
        ``NewsAnalysisResult`` avec toutes les métriques et l'UUID du signal persisté.

    Raises:
        ValueError: Si ``news_text`` ou ``category`` sont vides.

    Pipeline :
        source → indice de confiance → mapping sectoriel →
        probabilités bullish/bearish → force → TTL → persistence ``MarketSignal``
    """
    if not news_text or not news_text.strip():
        raise ValueError("news_text ne peut pas être vide.")
    if not category or not category.strip():
        raise ValueError("category ne peut pas être vide.")

    await asyncio.sleep(0)

    source = _extract_source(category)
    source_conf = _source_confidence(source)
    mapped_sector = map_sector(news_text)
    polarity, bullish, bearish = _compute_probabilities(news_text, category, source_conf)

    strength = _quantize(max(bullish, bearish))
    is_valid = strength >= MIN_SIGNAL_PROBABILITY
    ttl_minutes = _estimate_ttl_minutes(news_text, category, mapped_sector, strength)
    expires_at = datetime.now(UTC) + timedelta(minutes=ttl_minutes)
    asset_class = _resolve_asset_class(category)
    lc = news_text.lower()
    tokens = _tokenize(lc)

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
        is_valid_signal=is_valid,
        time_to_live_minutes=ttl_minutes,
        expires_at=expires_at,
        metadata_json={
            "pipeline_version": "v2.0",
            "asset_class": asset_class,
            "bullish_hits": sum(1 for kw in _BULLISH_WORD_KW if kw in tokens),
            "bearish_hits": sum(1 for kw in _BEARISH_WORD_KW if kw in tokens),
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
    """Croise les préférences utilisateur et les signaux valides pour décider d'un trade.

    Étapes :
        1. Vérification de l'utilisateur et du solde disponible.
        2. Récupération (ou création par défaut) des préférences.
        3. Sélection des 50 signaux valides non-expirés les plus forts.
        4. Filtrage sectoriel et par classe d'actif selon les préférences.
        5. Filtrage par seuil de probabilité minimum.
        6. Vérification de déduplication (pas deux trades sur le même signal).
        7. Calcul du capital recommandé (20 % du disponible, min 50 €).
        8. Ouverture de l'``ActiveTrade`` et retour de la décision.

    Args:
        user_id: UUID de l'utilisateur à évaluer.

    Returns:
        ``TradingOpportunityResult`` avec ``should_execute=True`` si un trade est ouvert.
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
                reason="Wallet introuvable pour cet utilisateur.",
                user_id=user_id,
            )
        if wallet.solde_disponible <= Decimal("0.00"):
            return TradingOpportunityResult(
                should_execute=False,
                reason="Aucun capital disponible pour ouvrir un trade.",
                user_id=user_id,
            )

        preference = await session.scalar(
            select(UserPreference).where(UserPreference.user_id == user_id)
        )
        if preference is None:
            preference = _default_preferences(user_id)
            session.add(preference)
            await session.flush()

        threshold = _quantize(
            max(preference.minimum_probability_threshold, MIN_SIGNAL_PROBABILITY)
        )

        recent_signals = (
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
                .limit(50)
            )
        ).scalars().all()

        if not recent_signals:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Aucun signal valide récent dans la base.",
                user_id=user_id,
            )

        eligible: list[MarketSignal] = []
        for signal in recent_signals:
            asset_class = _resolve_asset_class(signal.category)
            if not _is_asset_class_enabled(preference, asset_class):
                continue
            if not _is_sector_enabled(preference, signal.mapped_sector):
                continue
            if signal.signal_strength < threshold:
                continue
            eligible.append(signal)

        if not eligible:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason=(
                    f"Aucun signal ne dépasse le seuil de {threshold}% "
                    "ou ne correspond aux préférences sectorielles."
                ),
                user_id=user_id,
            )

        selected = eligible[0]

        existing = await session.scalar(
            select(ActiveTrade).where(
                ActiveTrade.user_id == user_id,
                ActiveTrade.market_signal_id == selected.id,
                ActiveTrade.status == "open",
            )
        )
        if existing is not None:
            await session.commit()
            return TradingOpportunityResult(
                should_execute=False,
                reason="Ce signal est déjà exploité par une position ouverte.",
                user_id=user_id,
                market_signal_id=selected.id,
            )

        recommended_capital = _quantize(
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
                market_signal_id=selected.id,
            )

        direction = "buy" if selected.sentiment_polarity != "negative" else "sell"
        duration = max(30, selected.time_to_live_minutes)
        planned_close = now + timedelta(minutes=duration)

        trade = ActiveTrade(
            user_id=user_id,
            market_signal_id=selected.id,
            asset_class=_resolve_asset_class(selected.category),
            sector=selected.mapped_sector,
            direction=direction,
            probability_used=selected.signal_strength,
            capital_engaged=recommended_capital,
            status="open",
            estimated_duration_minutes=duration,
            planned_close_at=planned_close,
        )
        session.add(trade)
        await session.commit()
        await session.refresh(trade)

    return TradingOpportunityResult(
        should_execute=True,
        reason="Opportunité validée : signal aligné avec les préférences utilisateur.",
        user_id=user_id,
        market_signal_id=selected.id,
        direction=direction,
        asset_class=trade.asset_class,
        sector=selected.mapped_sector,
        probability_used=selected.signal_strength,
        recommended_capital=recommended_capital,
        estimated_duration_minutes=duration,
        planned_close_at=planned_close,
        active_trade_id=trade.id,
    )
