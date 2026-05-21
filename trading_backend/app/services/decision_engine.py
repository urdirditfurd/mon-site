"""
Façade publique du coeur algorithmique.

Modules :
- ``app.services.news_analyzer`` : ``analyze_incoming_news``
- ``app.services.opportunity_evaluator`` : ``evaluate_trading_opportunity``
"""

from __future__ import annotations

from app.domain.decision import NewsAnalysisResult, TradingOpportunityResult
from app.services.news_analyzer import analyze_incoming_news
from app.services.opportunity_evaluator import evaluate_trading_opportunity

__all__ = [
    "NewsAnalysisResult",
    "TradingOpportunityResult",
    "analyze_incoming_news",
    "evaluate_trading_opportunity",
]
