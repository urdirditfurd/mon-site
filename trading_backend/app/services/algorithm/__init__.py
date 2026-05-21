"""Cœur algorithmique : analyse NLP simulée + décision d'opportunité."""

from __future__ import annotations

from app.services.algorithm.news_analyzer import analyze_incoming_news
from app.services.algorithm.opportunity_evaluator import evaluate_trading_opportunity
from app.services.algorithm.types import NewsAnalysisResult, TradingOpportunityResult

__all__ = (
    "NewsAnalysisResult",
    "TradingOpportunityResult",
    "analyze_incoming_news",
    "evaluate_trading_opportunity",
)
