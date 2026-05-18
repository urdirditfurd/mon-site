"""Moteur NLP mock pour transformer un titre en signal de trading."""

from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(slots=True)
class NLPAnalysis:
    """Résultat de l'analyse d'une actualité."""

    direction: str
    confidence: float
    impact_label: str


class MockNLPEngine:
    """Simule un modèle FinBERT/GPT orienté finance."""

    def __init__(self) -> None:
        self._bullish_keywords = {
            "nouvelle puce",
            "croissance",
            "partenariat",
            "record",
            "hausse",
            "bénéfice",
            "contrat",
            "acquisition",
            "upgrade",
        }
        self._bearish_keywords = {
            "inflation",
            "licenciement",
            "tensions",
            "baisse",
            "enquête",
            "amende",
            "retard",
            "prudente",
            "downgrade",
        }

    def analyze(self, headline: str) -> NLPAnalysis:
        """Calcule une direction + confiance probabiliste à partir du texte."""

        lowered = headline.lower()
        bullish_score = sum(keyword in lowered for keyword in self._bullish_keywords)
        bearish_score = sum(keyword in lowered for keyword in self._bearish_keywords)

        # Bruit aléatoire pour simuler les variations d'un modèle IA.
        noise = random.uniform(-4.0, 4.0)
        base_confidence = 70.0 + (bullish_score * 7.5) + (bearish_score * 7.5) + noise
        confidence = round(min(max(base_confidence, 50.0), 99.0), 2)

        if bullish_score > bearish_score:
            return NLPAnalysis(direction="buy", confidence=confidence, impact_label="haussier")
        if bearish_score > bullish_score:
            return NLPAnalysis(direction="sell", confidence=confidence, impact_label="baissier")

        # Cas neutre: direction déterminée par un léger biais aléatoire.
        direction = random.choice(["buy", "sell"])
        impact_label = "haussier" if direction == "buy" else "baissier"
        neutral_confidence = round(random.uniform(52.0, 73.0), 2)
        return NLPAnalysis(direction=direction, confidence=neutral_confidence, impact_label=impact_label)
