/**
 * Résolution des clés API (priorité : requête → .env → variables système).
 * Ne jamais exposer ces valeurs au navigateur ni les committer.
 */

function resolveHfToken(explicit) {
  return String(
    explicit || process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN || ""
  ).trim();
}

function resolveMistralKey(explicit) {
  return String(
    explicit ||
      process.env.MISTRAL_API_KEY ||
      process.env.MISTRAL_KEY ||
      process.env.MISTRAL_API_KEY_FREE ||
      ""
  ).trim();
}

function resolveFalKey(explicit) {
  return String(explicit || process.env.FAL_KEY || process.env.FAL_API_KEY || "").trim();
}

function getServerAiSecretsStatus() {
  return {
    hasHfToken: Boolean(resolveHfToken()),
    hasMistralKey: Boolean(resolveMistralKey()),
    hasFalKey: Boolean(resolveFalKey()),
    source: "Utilisez un fichier .env local (voir .env.example) — jamais dans le code HTML/JS"
  };
}

module.exports = {
  resolveHfToken,
  resolveMistralKey,
  resolveFalKey,
  getServerAiSecretsStatus
};
