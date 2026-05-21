"""Cartographie texte → secteur avec frontières de mots (réduit les faux positifs)."""

from __future__ import annotations

import re

from app.services.algorithm.constants import (
    SECTOR_FOOD,
    SECTOR_GENERAL,
    SECTOR_INSURANCE,
    SECTOR_MINES,
    SECTOR_REAL_ESTATE,
    SECTOR_TECH,
)

# Ordre = priorité (première règle satisfaite gagne)
_SECTOR_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        SECTOR_MINES,
        re.compile(
            r"\b("
            r"or|gold|lithium|cuivre|copper|nickel|"
            r"mining|mines?|matières?\s*premières|commodit(?:y|ies)|"
            r"minerai|extraction"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    (
        SECTOR_TECH,
        re.compile(
            r"\b("
            r"nvidia|apple|microsoft|google|meta|"
            r"\bia\b|\bai\b|intelligence\s+artificielle|semiconductor|"
            r"chip|puce|logiciel|software|cloud|cyber|saas|datacenter"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    (
        SECTOR_REAL_ESTATE,
        re.compile(
            r"\b("
            r"real\s+estate|reit|housing|mortgage|immobilier|"
            r"property|promoteur|foncier"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    (
        SECTOR_INSURANCE,
        re.compile(
            r"\b("
            r"insurance|assurance|reinsurance|réassurance|insurer|"
            r"sinistre|primes?\s+d'assurance"
            r")\b",
            re.IGNORECASE,
        ),
    ),
    (
        SECTOR_FOOD,
        re.compile(
            r"\b("
            r"food|agri|agriculture|wheat|blé|sugar|sucre|"
            r"alimentation|beverage|boisson|agro"
            r")\b",
            re.IGNORECASE,
        ),
    ),
)


def map_sector_from_news_text(news_text: str) -> str:
    """Associe la news au secteur le plus pertinent via mots-clés bornés.

    Exemple : « hausse du lithium en Australie » → ``mines`` ;
    « coordination budget » ne matche pas le mot français « or » (évite faux positifs).
    """

    for sector, pattern in _SECTOR_RULES:
        if pattern.search(news_text):
            return sector
    return SECTOR_GENERAL
