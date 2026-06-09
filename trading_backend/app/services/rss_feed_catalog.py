"""Sources RSS internationales fiables pour l'accueil SentiQ."""

from __future__ import annotations

# Flux gratuits, stables, usage lecture (RSS public).
# Personnalisable via NEWS_RSS_FEEDS dans .env.production
DEFAULT_RSS_FEEDS: list[dict[str, str]] = [
    {
        "label": "BBC Business",
        "category": "finance",
        "url": "https://feeds.bbci.co.uk/news/business/rss.xml",
    },
    {
        "label": "BBC World",
        "category": "monde",
        "url": "https://feeds.bbci.co.uk/news/world/rss.xml",
    },
    {
        "label": "CNBC",
        "category": "marches",
        "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    },
    {
        "label": "MarketWatch",
        "category": "finance",
        "url": "https://feeds.marketwatch.com/marketwatch/topstories/",
    },
    {
        "label": "Yahoo Finance",
        "category": "marches",
        "url": "https://finance.yahoo.com/news/rssindex",
    },
    {
        "label": "BCE",
        "category": "macro",
        "url": "https://www.ecb.europa.eu/rss/press.html",
    },
    {
        "label": "FMI",
        "category": "macro",
        "url": "https://www.imf.org/external/np/speeches/rss.aspx",
    },
    {
        "label": "Investing.com",
        "category": "marches",
        "url": "https://www.investing.com/rss/news.rss",
    },
]

CATEGORY_LABELS = {
    "finance": "Finance",
    "marches": "Marchés",
    "monde": "Monde",
    "macro": "Macro",
    "societe": "Société",
    "tech": "Tech",
}
