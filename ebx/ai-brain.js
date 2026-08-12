/**
 * EBX AI Brain — Local LLM Integration
 *
 * Modèles recommandés (GGUF, compatibles LM Studio / Pinokio / PocketPal) :
 *   - Qwen2.5-7B-Instruct-GGUF  (meilleur respect du format JSON)
 *   - Meta-Llama-3-8B-Instruct-GGUF (excellent pour le code structuré)
 *
 * Prérequis :
 *   1. Installer LM Studio → charger un modèle → onglet "Local Server" → activer CORS → port 1234
 *   2. Créer un fichier .env : LOCAL_LLM_URL=http://localhost:1234/v1
 *   3. npm install openai jsonrepair dotenv
 */

const OpenAI = require("openai");
const { jsonrepair } = require("jsonrepair");
const { normalizeListingLang, getListingUi, languageLabel } = require("./listing-i18n");

const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || "http://localhost:1234/v1";

const client = new OpenAI({
  baseURL: LOCAL_LLM_URL,
  apiKey: "not-needed",
});

const SYSTEM_PROMPT = `Tu es un expert en optimisation de listings eBay FR (dropshipping discret).
Tu dois répondre UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après.

Règles pour "seo_title" (CRITIQUE) :
- NE COPIE PAS le titre fournisseur Amazon/AliExpress.
- Réécris en français SEO, max 80 caractères, ordre des mots DIFFÉRENT.
- Pas de nom de marketplace (AliExpress, Amazon, Cdiscount, eBay), pas de codes SKU, pas de caractères chinois.
- INTERDICTION : "potentiel de marge", "Source :", "- AliExpress".
- Inclure 1 bénéfice (Compatible / Compact / Pratique / Neuf / Qualité).

Règles absolues pour le champ "html_description" :
- Utilise UNIQUEMENT du HTML5 de base et du CSS inline (style="...").
- INTERDICTION TOTALE : pas de balises <script>, pas de <iframe>, pas de liens CSS externes (<link>), pas de balises <style>, pas de classes CSS complexes non définies inline.
- INTERDICTION : "potentiel de marge", lignes "Source :", noms de marketplace (AliExpress, Amazon…) dans le titre H1.
- Structure obligatoire : Un en-tête avec titre, une section de caractéristiques en grille simple (display:grid inline), et un tableau de spécifications.
- Le design doit être professionnel, mobile-friendly, avec des couleurs douces.

Format JSON de réponse :
{
  "seo_title": "string (max 80 caractères)",
  "html_description": "string (HTML valide avec CSS inline uniquement)",
  "suggested_price": number,
  "tags": ["string"]
}`;

/**
 * Nettoie la sortie brute d'un LLM local et extrait un objet JSON valide.
 * Gère les cas courants : blocs ```json, texte parasite, guillemets cassés.
 */
function cleanAndParseJSON(responseText) {
  let cleaned = responseText.trim();

  // Supprimer les blocs markdown ```json ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  // Extraire le contenu entre le premier { et le dernier }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // Tentative 1 : parse direct
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Tentative 2 : réparation avec jsonrepair
    try {
      const repaired = jsonrepair(cleaned);
      return JSON.parse(repaired);
    } catch (_) {
      // Fallback : objet par défaut sécurisé
      return {
        seo_title: "Produit eBay — Voir description",
        html_description: `<div style="font-family:Arial,sans-serif;padding:20px;"><h1 style="color:#333;">Produit</h1><p>Description indisponible — veuillez réessayer.</p></div>`,
        suggested_price: 0,
        tags: [],
        _parse_error: true,
      };
    }
  }
}

/**
 * Génère un listing eBay complet via le LLM local.
 */
async function generateListing(productName, rawKeywords, options = {}) {
  const language = normalizeListingLang(options.language || options.lang || "fr");
  const L = getListingUi(language);
  const langName = L.aiLangName;
  const systemByLang = {
    fr: SYSTEM_PROMPT,
    en: SYSTEM_PROMPT.replace(/français/gi, "English")
      .replace(/eBay FR/g, "eBay EN/US")
      .replace(/Compatible \/ Compact \/ Pratique \/ Neuf \/ Qualité/g, "Compatible / Compact / Practical / New / Quality"),
    de: SYSTEM_PROMPT.replace(/français/gi, "Deutsch")
      .replace(/eBay FR/g, "eBay DE")
      .replace(/Compatible \/ Compact \/ Pratique \/ Neuf \/ Qualité/g, "Kompatibel / Kompakt / Praktisch / Neu / Qualität"),
  };
  const userPrompt =
    language === "en"
      ? `Generate an optimized eBay listing for this product:
Name: ${productName}
Keywords: ${rawKeywords}
Target language: English

Reply ONLY with the JSON, nothing else.`
      : language === "de"
        ? `Erstelle eine optimierte eBay-Anzeige für dieses Produkt:
Name: ${productName}
Keywords: ${rawKeywords}
Zielsprache: Deutsch

Antworte NUR mit dem JSON, sonst nichts.`
        : `Génère un listing eBay optimisé pour ce produit :
Nom : ${productName}
Mots-clés : ${rawKeywords}
Langue cible : ${langName}

Réponds UNIQUEMENT avec le JSON, rien d'autre.`;

  const completion = await client.chat.completions.create({
    model: "local-model",
    messages: [
      { role: "system", content: systemByLang[language] || SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  });

  const rawContent = completion.choices[0].message.content;
  const parsed = cleanAndParseJSON(rawContent);
  return { ...parsed, language, language_label: languageLabel(language) };
}

/**
 * Brouillon de réponse SAV (LLM local si dispo, sinon null → fallback template).
 */
async function generateSavReply({ buyer, subject, body, product } = {}) {
  const userPrompt = `Tu es un agent SAV eBay professionnel (vendeur FR).
Rédige UNE réponse courte (max 120 mots), polie, en français, sans promettre de remboursement automatique.
Escalade humaine si litige / remboursement agressif / menace / jamais reçu.

Message acheteur:
- Acheteur: ${buyer || "client"}
- Produit: ${product || "n/a"}
- Sujet: ${subject || "n/a"}
- Corps: ${String(body || "").slice(0, 800)}

Réponds UNIQUEMENT en JSON:
{"draft":"texte","escalate":false,"reason":"","confidence":0.0}`;

  const completion = await client.chat.completions.create({
    model: "local-model",
    messages: [
      {
        role: "system",
        content:
          "Tu réponds UNIQUEMENT avec un JSON valide {draft, escalate, reason, confidence}. Pas de markdown.",
      },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 512,
  });

  const rawContent = completion.choices[0].message.content;
  const parsed = cleanAndParseJSON(rawContent);
  if (parsed._parse_error || !parsed.draft) {
    throw new Error("SAV LLM parse fail");
  }
  return {
    draft: String(parsed.draft).trim(),
    escalate: Boolean(parsed.escalate),
    reason: String(parsed.reason || ""),
    confidence: Number(parsed.confidence) || 0.5,
    source: "llm",
  };
}

/**
 * Réponse courte pour le chat d'aide produit (optionnel — le serveur a une FAQ).
 */
async function generateHelpReply(message = "") {
  const completion = await client.chat.completions.create({
    model: "local-model",
    messages: [
      {
        role: "system",
        content:
          "Tu es l'assistant d'aide EBX (dropshipping eBay). Réponds en français, max 80 mots, concret. JSON uniquement: {\"reply\":\"...\"}",
      },
      { role: "user", content: String(message).slice(0, 400) },
    ],
    temperature: 0.3,
    max_tokens: 256,
  });
  const parsed = cleanAndParseJSON(completion.choices[0].message.content);
  if (parsed._parse_error || !parsed.reply) throw new Error("help LLM parse fail");
  return { reply: String(parsed.reply).trim(), source: "llm" };
}

/**
 * Enrichit un listing à partir des infos produit scrapées (titre, bullets, specs).
 * Retourne du JSON structuré — le HTML est reconstruit côté template (pas de HTML IA).
 * @param {object} product
 * @param {{ language?: string, lang?: string }} [options]
 */
async function generateProductCopy(product = {}, options = {}) {
  const language = normalizeListingLang(options.language || options.lang || product.language || "fr");
  const L = getListingUi(language);
  const fallbackName = language === "de" ? "Produkt" : language === "en" ? "Product" : "Produit";
  const title = String(product.title || product.originalTitle || fallbackName).slice(0, 160);
  const bullets = (product.bullets || []).slice(0, 8).join(" | ");
  const specs = product.specs
    ? Object.entries(product.specs)
        .slice(0, 12)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ")
    : "";
  const desc = String(product.description || "").slice(0, 500);

  const langRules = {
    fr: {
      system: `Tu es un rédacteur eBay FR. Réponds UNIQUEMENT en JSON valide.
Objectif: décrire le VRAI produit (attributs physiques / usage), pas le service vendeur.
Tout le contenu texte doit être en français.
INTERDICTION: AliExpress, Amazon, Cdiscount, eBay, "potentiel de marge", "Source :", "demande eBay".
Titre SEO max 80 caractères, keywords français, ordre de mots différent du titre fournisseur.

Format:
{
  "seo_title": "string",
  "short_pitch": "1 phrase accrocheuse",
  "sections": [{"heading":"string","body":"2-3 phrases"}],
  "benefits": ["6 bénéfices produit concrets"],
  "specs": {"Matériau":"...","Dimensions":"...","Type":"...","État":"Neuf"},
  "suggested_price": number
}`,
      user: `Produit scrapé:
Titre: ${title}
Description: ${desc}
Bullets: ${bullets}
Specs: ${specs}
Prix fournisseur: ${product.price ?? "n/a"}
Langue cible: français

Génère 3 sections (matière/design/usage si pertinent), 6 bénéfices et un tableau specs réalistes — entièrement en français.`,
    },
    en: {
      system: `You are an eBay listing copywriter. Reply ONLY with valid JSON.
Goal: describe the REAL product (physical attributes / use), not seller service.
All text content must be in English.
FORBIDDEN: AliExpress, Amazon, Cdiscount, eBay, "margin potential", "Source :".
SEO title max 80 characters, English keywords, word order DIFFERENT from supplier title.

Format:
{
  "seo_title": "string",
  "short_pitch": "1 catchy sentence",
  "sections": [{"heading":"string","body":"2-3 sentences"}],
  "benefits": ["6 concrete product benefits"],
  "specs": {"Material":"...","Dimensions":"...","Type":"...","Condition":"New"},
  "suggested_price": number
}`,
      user: `Scraped product:
Title: ${title}
Description: ${desc}
Bullets: ${bullets}
Specs: ${specs}
Supplier price: ${product.price ?? "n/a"}
Target language: English

Generate 3 sections (material/design/use if relevant), 6 benefits and a realistic specs table — entirely in English.`,
    },
    de: {
      system: `Du bist ein eBay-Anzeigentexter. Antworte NUR mit gültigem JSON.
Ziel: das ECHTE Produkt beschreiben (physische Attribute / Nutzung), nicht den Verkäuferservice.
Alle Textinhalte müssen auf Deutsch sein.
VERBOTEN: AliExpress, Amazon, Cdiscount, eBay, "Margenpotenzial", "Source :".
SEO-Titel max. 80 Zeichen, deutsche Keywords, andere Wortreihenfolge als der Lieferantentitel.

Format:
{
  "seo_title": "string",
  "short_pitch": "1 einprägsamer Satz",
  "sections": [{"heading":"string","body":"2-3 Sätze"}],
  "benefits": ["6 konkrete Produktvorteile"],
  "specs": {"Material":"...","Abmessungen":"...","Typ":"...","Zustand":"Neu"},
  "suggested_price": number
}`,
      user: `Gescraptes Produkt:
Titel: ${title}
Beschreibung: ${desc}
Bullets: ${bullets}
Specs: ${specs}
Lieferantenpreis: ${product.price ?? "n/a"}
Zielsprache: Deutsch

Erstelle 3 Abschnitte (Material/Design/Nutzung falls relevant), 6 Vorteile und eine realistische Specs-Tabelle — vollständig auf Deutsch.`,
    },
  };

  const pack = langRules[language] || langRules.fr;

  const completion = await client.chat.completions.create({
    model: "local-model",
    messages: [
      { role: "system", content: pack.system },
      { role: "user", content: pack.user },
    ],
    temperature: 0.55,
    max_tokens: 1600,
  });

  const parsed = cleanAndParseJSON(completion.choices[0].message.content);
  if (parsed._parse_error) throw new Error("Product copy LLM parse fail");
  return {
    ...parsed,
    language,
    language_label: languageLabel(language),
    market_hint: L.aiMarket,
  };
}

module.exports = {
  generateListing,
  cleanAndParseJSON,
  generateSavReply,
  generateProductCopy,
  generateHelpReply,
};
