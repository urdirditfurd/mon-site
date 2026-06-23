const FRENCH_STOPWORDS = new Set([
  "alors",
  "apres",
  "aussi",
  "avec",
  "avoir",
  "cette",
  "cela",
  "comme",
  "comment",
  "dans",
  "depuis",
  "elle",
  "elles",
  "entre",
  "etre",
  "fait",
  "font",
  "leur",
  "leurs",
  "mais",
  "meme",
  "moins",
  "nous",
  "pour",
  "plus",
  "pourquoi",
  "quand",
  "sans",
  "sera",
  "sont",
  "sur",
  "tres",
  "tout",
  "tous",
  "une",
  "vous",
  "video",
  "videos",
  "source"
]);

const CINEMATIC_STYLES = [
  "dynamic handheld motion",
  "cinematic lighting",
  "high contrast atmosphere",
  "rich depth of field",
  "social media short energy",
  "subtle camera parallax",
  "dramatic motion blur",
  "high-detail textures"
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitIntoSentences(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function chunkArray(items, chunkCount) {
  const safeCount = Math.max(1, Math.min(items.length || 1, chunkCount || 1));
  const chunks = Array.from({ length: safeCount }, () => []);
  items.forEach((item, index) => {
    chunks[index % safeCount].push(item);
  });
  return chunks.filter((chunk) => chunk.length > 0);
}

function extractKeywords(text, limit = 6) {
  const tokens = normalizeText(text)
    .toLowerCase()
    .match(/[a-z0-9à-ÿ]+/gi);
  if (!tokens) return [];

  const counts = new Map();
  for (const token of tokens) {
    if (token.length < 4) continue;
    if (FRENCH_STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"))
    .slice(0, limit)
    .map(([token]) => token);
}

function pickStyle(index) {
  return CINEMATIC_STYLES[index % CINEMATIC_STYLES.length];
}

function capSentence(text, maxLength = 140) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function capitalize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildClipTitle(text, fallback) {
  const keywords = extractKeywords(text, 3);
  if (!keywords.length) return fallback;
  return capitalize(keywords.join(" · "));
}

function buildHook(text, fallback) {
  const keywords = extractKeywords(text, 2);
  if (!keywords.length) return fallback;
  return `Le moment le plus fort sur ${keywords.join(" et ")} commence ici.`;
}

function buildHashtags(text) {
  const keywords = extractKeywords(text, 4);
  const tags = ["#shorts", "#videoai"];
  for (const keyword of keywords) {
    const compact = keyword.replace(/[^a-z0-9à-ÿ]/gi, "");
    if (!compact) continue;
    tags.push(`#${compact}`);
  }
  return Array.from(new Set(tags)).slice(0, 6);
}

function buildNarrationFromSentences(sentences, fallbackHook) {
  const cleaned = sentences.map((sentence) => capSentence(sentence, 120)).filter(Boolean);
  if (!cleaned.length) {
    return `${fallbackHook} On garde le rythme et on pousse le détail qui marque le plus.`;
  }
  return [fallbackHook, ...cleaned.slice(0, 3)].join(" ");
}

function buildVisualPrompt(text, aspectRatio, sceneIndex, totalScenes) {
  const keywords = extractKeywords(text, 5);
  const subject = keywords.length ? keywords.join(", ") : "cinematic viral concept";
  const motionHint =
    sceneIndex === 0
      ? "strong opening motion"
      : sceneIndex === totalScenes - 1
        ? "impactful closing reveal"
        : "kinetic mid-scene motion";

  return `${subject}, ${motionHint}, ${pickStyle(sceneIndex)}, ${aspectRatio} composition, no subtitles, no watermark, no logo, no celebrity face, original content`;
}

function buildSceneNarration(sentences, hook, sceneIndex) {
  const base = sentences.map((sentence) => capSentence(sentence, 110)).filter(Boolean);
  if (!base.length) {
    return sceneIndex === 0 ? hook : "La tension monte et l'image doit rester percutante.";
  }
  if (sceneIndex === 0) return `${hook} ${base[0]}`;
  return base.join(" ");
}

function planViralScriptsFromTranscript({
  sourceTranscript,
  sourceTitle,
  clipsCount,
  clipDurationSec,
  aspectRatio,
  sceneDurationSec
}) {
  const sentences = splitIntoSentences(sourceTranscript);
  const fallbackSentences = sentences.length ? sentences : [normalizeText(sourceTitle || "contenu viral original")];
  const scriptGroups = chunkArray(fallbackSentences, Math.max(1, clipsCount));
  const scenesPerScript = Math.max(1, Math.ceil(clipDurationSec / Math.max(1, sceneDurationSec)));

  return scriptGroups.slice(0, clipsCount).map((group, scriptIndex) => {
    const groupText = group.join(" ");
    const title = buildClipTitle(groupText, `Short viral ${scriptIndex + 1}`);
    const hook = buildHook(groupText, `Regarde bien le tournant du short ${scriptIndex + 1}.`);
    const narration = buildNarrationFromSentences(group, hook);
    const sceneGroups = chunkArray(group, scenesPerScript);

    const scenes = sceneGroups.map((sceneSentences, sceneIndex) => {
      const sceneText = sceneSentences.join(" ");
      return {
        index: sceneIndex + 1,
        visualPrompt: buildVisualPrompt(sceneText || groupText, aspectRatio, sceneIndex, sceneGroups.length),
        narration: buildSceneNarration(sceneSentences, hook, sceneIndex),
        durationSec: sceneDurationSec
      };
    });

    return {
      title,
      hook,
      narration,
      hashtags: buildHashtags(groupText),
      scenes
    };
  });
}

function buildTopicBeat(topic, phase, index) {
  switch (phase) {
    case "hook":
      return {
        narration: `Imagine ${topic}. En quelques secondes, tout bascule et l'attention est captée.`,
        visual: `${topic}, bold opening shot, fast cinematic motion`
      };
    case "setup":
      return {
        narration: `Le décor se pose autour de ${topic}, avec une montée progressive de tension et de curiosité.`,
        visual: `${topic}, environmental setup, layered details, immersive cinematic composition`
      };
    case "build":
      return {
        narration: `Chaque détail renforce l'histoire de ${topic}, avec un rythme plus intense et une sensation d'élan.`,
        visual: `${topic}, escalating action, dramatic camera move, rich atmosphere`
      };
    case "reveal":
      return {
        narration: `Le point clé apparaît enfin, et ${topic} prend une dimension plus spectaculaire et plus claire.`,
        visual: `${topic}, reveal moment, dramatic lighting, cinematic focus shift`
      };
    case "payoff":
      return {
        narration: `Le payoff arrive: ${topic} livre enfin son impact visuel le plus mémorable.`,
        visual: `${topic}, cinematic payoff, emotionally charged motion, premium lighting`
      };
    default:
      return {
        narration: `Dernier battement: ${topic} reste en tête avec une sortie nette, rapide et mémorable.`,
        visual: `${topic}, closing shot, elegant cinematic finish, lasting visual impact`
      };
  }
}

function planScenesFromTopic({ topic, durationMin, clipSec, aspectRatio }) {
  const normalizedTopic = normalizeText(topic || "histoire cinématique");
  const sceneCount = Math.max(1, Math.ceil((Math.max(1, durationMin) * 60) / Math.max(1, clipSec)));
  const phases = ["hook", "setup", "build", "reveal", "payoff", "outro"];
  const scenes = [];

  for (let index = 0; index < sceneCount; index += 1) {
    const phase =
      index === 0
        ? "hook"
        : index === sceneCount - 1
          ? "outro"
          : phases[(index % Math.max(1, phases.length - 1)) + 1];
    const beat = buildTopicBeat(normalizedTopic, phase, index);
    scenes.push({
      index: index + 1,
      visualPrompt: `${beat.visual}, ${pickStyle(index)}, ${aspectRatio} composition, no subtitles, no watermark, no logo`,
      narration: beat.narration,
      durationSec: clipSec
    });
  }

  return {
    title: capitalize(`${normalizedTopic} — version cinématique IA`),
    scenes
  };
}

module.exports = {
  normalizeText,
  splitIntoSentences,
  extractKeywords,
  planViralScriptsFromTranscript,
  planScenesFromTopic
};
