/**
 * EBX Server — Point d'entrée API
 *
 * Démarrage :
 *   1. npm install
 *   2. Lancer LM Studio avec un modèle chargé (serveur local sur le port 1234)
 *   3. node server.js
 *   4. Le frontend appelle POST http://localhost:3000/api/generate-listing
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const { generateListing } = require("./ai-brain");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Endpoint principal : génération de listing eBay via LLM local
app.post("/api/generate-listing", async (req, res) => {
  const { productName, rawKeywords } = req.body;

  if (!productName) {
    return res.status(400).json({ error: "productName est requis" });
  }

  try {
    const listing = await generateListing(productName, rawKeywords || "");
    return res.json({ success: true, data: listing });
  } catch (err) {
    console.error("[EBX] Erreur LLM :", err.message);

    // Distinguer les erreurs réseau (LLM non lancé) des autres
    if (err.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        error: "LLM local non disponible. Vérifie que LM Studio tourne sur le port 1234.",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Erreur lors de la génération. Réessaie.",
    });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", llm_url: process.env.LOCAL_LLM_URL || "http://localhost:1234/v1" });
});

app.listen(PORT, () => {
  console.log(`⚡ EBX Server running on http://localhost:${PORT}`);
  console.log(`🧠 LLM endpoint: ${process.env.LOCAL_LLM_URL || "http://localhost:1234/v1"}`);
});
