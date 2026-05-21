"""Tests unitaires du moteur de décision sans dépendance base de données."""

from __future__ import annotations

import unittest
from decimal import Decimal

from app.services import decision_engine


class DecisionEnginePureLogicTest(unittest.TestCase):
    """Valide les règles déterministes du pipeline NLP simulé."""

    def test_sector_mapping_avoids_gold_keyword_false_positive(self) -> None:
        news_text = "Nvidia posts record AI software growth after a cloud partnership."

        mapped_sector = decision_engine._map_sector(news_text)

        self.assertEqual(mapped_sector, decision_engine.SECTOR_TECH)

    def test_sector_mapping_supports_french_gold_and_lithium_news(self) -> None:
        news_text = "Le lithium et l'or progressent après une acquisition minière."

        mapped_sector = decision_engine._map_sector(news_text)

        self.assertEqual(mapped_sector, decision_engine.SECTOR_MINES)

    def test_explicit_probability_is_blended_into_bullish_score(self) -> None:
        polarity, bullish, bearish = decision_engine._compute_probabilities(
            "Reuters score 82%: upgrade and growth expectations for a chip leader.",
            "reuters stocks",
            Decimal("93.00"),
        )

        self.assertEqual(polarity, "positive")
        self.assertGreater(bullish, Decimal("70.00"))
        self.assertLess(bearish, Decimal("30.00"))


if __name__ == "__main__":
    unittest.main()
