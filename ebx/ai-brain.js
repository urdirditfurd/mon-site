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
async function generateListing(productName, rawKeywords) {
  const userPrompt = `Génère un listing eBay optimisé pour ce produit :
Nom : ${productName}
Mots-clés : ${rawKeywords}

Réponds UNIQUEMENT avec le JSON, rien d'autre.`;

  const completion = await client.chat.completions.create({
    model: "local-model",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  });

  const rawContent = completion.choices[0].message.content;
  return cleanAndParseJSON(rawContent);
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

module.exports = { generateListing, cleanAndParseJSON, generateSavReply };
