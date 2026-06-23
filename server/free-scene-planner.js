/**
 * Planification de scènes 100 % gratuite.
 * Modes : mistral (Free Tier console.mistral.ai), free (templates), ollama (local).
 */

const DEFAULT_MISTRAL_PLANNER_MODEL = "mistral-small-2506";

const SCENE_TEMPLATES = [
  "Cinematic wide establishing shot of {topic}, dramatic lighting, atmospheric depth, film grain",
  "Dynamic medium shot exploring {topic}, smooth camera movement, rich colors, professional cinematography",
  "Close-up detail sequence about {topic}, shallow depth of field, moody ambiance, high production value",
  "Aerial or elevated perspective on {topic}, sweeping motion, golden hour lighting, epic scale",
  "Silhouette figures in scene about {topic}, backlit, mysterious atmosphere, no recognizable faces",
  "Slow tracking shot through environment related to {topic}, volumetric light, cinematic composition",
  "Action-oriented moment depicting {topic}, energetic camera work, vivid contrast, motion blur accents",
  "Emotional atmospheric scene about {topic}, soft bokeh, reflective surfaces, storytelling mood",
  "Abstract visual metaphor for {topic}, artistic framing, surreal elements, dreamlike quality",
  "Powerful concluding visual of {topic}, dramatic finale composition, lens flare, epic resolution"
];

const NARRATION_HOOKS = [
  "Découvrons ce sujet fascinant.",
  "Voici un angle que peu connaissent.",
  "Regardons les détails qui changent tout.",
  "Une perspective nouvelle s'impose.",
  "L'ambiance se transforme progressivement.",
  "Chaque élément prend son sens.",
  "L'intensité monte d'un cran.",
  "Les pièces du puzzle s'assemblent.",
  "Une révélation visuelle s'annonce.",
  "Voici la conclusion de notre voyage."
];

function splitScriptIntoChunks(script, sceneCount) {
  const text = String(script || "").trim();
  if (!text) return [];

  const paragraphs = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  let chunks = paragraphs.length >= 2 ? [...paragraphs] : [];

  if (chunks.length < sceneCount) {
    const sentences = text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length >= sceneCount) {
      chunks = [];
      const perChunk = Math.ceil(sentences.length / sceneCount);
      for (let i = 0; i < sceneCount; i += 1) {
        const slice = sentences.slice(i * perChunk, (i + 1) * perChunk).join(" ").trim();
        if (slice) chunks.push(slice);
      }
    }
  }

  if (!chunks.length) {
    const words = text.split(/\s+/);
    const perChunk = Math.max(1, Math.ceil(words.length / sceneCount));
    for (let i = 0; i < sceneCount; i += 1) {
      chunks.push(words.slice(i * perChunk, (i + 1) * perChunk).join(" ").trim());
    }
  }

  while (chunks.length > sceneCount) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${tail}`.trim();
  }

  while (chunks.length < sceneCount) {
    chunks.push(chunks[chunks.length - 1] || text.slice(0, 240));
  }

  return chunks.slice(0, sceneCount).filter(Boolean);
}

function buildPlanFromScriptChunks({ script, durationMin, clipSec, sceneCount }) {
  const chunks = splitScriptIntoChunks(script, sceneCount);
  const title = String(script || "")
    .split(/\n/)[0]
    .trim()
    .slice(0, 80);

  const scenes = chunks.map((narration, i) => {
    const snippet = narration.slice(0, 160);
    const template = SCENE_TEMPLATES[i % SCENE_TEMPLATES.length];
    return {
      index: i + 1,
      visualPrompt: template.replace(/\{topic\}/g, snippet),
      narration,
      durationSec: clipSec
    };
  });

  return { title: title || "Vidéo personnalisée", scenes };
}

async function planScenesFromScriptWithMistral({
  script,
  durationMin,
  clipSec,
  aspectRatio,
  mistralKey,
  mistralModel
}) {
  const sceneCount = Math.ceil((durationMin * 60) / clipSec);
  const prompt = `Tu es directeur de création vidéo. À partir du script utilisateur, produis un plan JSON pour une vidéo de ${durationMin} minutes.

Script utilisateur :
"""
${String(script).slice(0, 12000)}
"""

Format : ${aspectRatio}
Durée par scène : ${clipSec}s
Nombre de scènes EXACT : ${sceneCount}

Règles :
- Répartis le script en scènes cohérentes (narration en français)
- Prompts visuels en anglais, cinématiques, sans logos ni célébrités
- Pas de texte à l'écran dans les visuels

Réponds UNIQUEMENT en JSON valide :
{"title":"...","scenes":[{"index":1,"visualPrompt":"...","narration":"...","durationSec":${clipSec}}]}`;

  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mistralKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: mistralModel || process.env.MISTRAL_PLANNER_MODEL || DEFAULT_MISTRAL_PLANNER_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.65,
      max_tokens: Math.min(16000, 500 + sceneCount * 140)
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mistral script plan: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Réponse Mistral invalide (JSON attendu)");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) {
    throw new Error("Plan script invalide");
  }
  return { ...parsed, scenes: parsed.scenes.slice(0, sceneCount) };
}

async function planScenesFromScript(options) {
  const sceneCount = Math.ceil((Number(options.durationMin) * 60) / Number(options.clipSec));
  const mistralKey = String(options.mistralKey || "").trim();

  if (mistralKey) {
    try {
      return await planScenesFromScriptWithMistral({
        ...options,
        mistralKey,
        mistralModel: options.mistralModel || DEFAULT_MISTRAL_PLANNER_MODEL
      });
    } catch (error) {
      if (process.env.SULPHUR_PLANNER_FALLBACK === "0") throw error;
    }
  }

  return buildPlanFromScriptChunks({
    script: options.script,
    durationMin: options.durationMin,
    clipSec: options.clipSec,
    sceneCount
  });
}

function buildFreePlan({ topic, durationMin, clipSec }) {
  const sceneCount = Math.ceil((durationMin * 60) / clipSec);
  const cleanTopic = String(topic || "creative visual story").trim();
  const scenes = [];

  for (let i = 0; i < sceneCount; i += 1) {
    const template = SCENE_TEMPLATES[i % SCENE_TEMPLATES.length];
    const hook = NARRATION_HOOKS[i % NARRATION_HOOKS.length];
    const visualPrompt = template.replace(/\{topic\}/g, cleanTopic);
    scenes.push({
      index: i + 1,
      visualPrompt,
      narration: `${hook} ${cleanTopic}.`,
      durationSec: clipSec
    });
  }

  return {
    title: cleanTopic.slice(0, 80),
    scenes
  };
}

async function planScenesWithOllama({
  topic,
  durationMin,
  clipSec,
  aspectRatio,
  ollamaModel,
  ollamaUrl
}) {
  const sceneCount = Math.ceil((durationMin * 60) / clipSec);
  const baseUrl = String(ollamaUrl || process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = String(ollamaModel || process.env.OLLAMA_MODEL || "llama3.2").trim();

  const prompt = `Tu es un directeur de création vidéo. Génère un plan JSON pour une vidéo de ${durationMin} minutes.
Sujet : ${topic}
Format : ${aspectRatio}
Durée par scène : ${clipSec}s
Nombre de scènes EXACT : ${sceneCount}

Règles : contenu original, prompts visuels en anglais, narration en français, pas de logos ni célébrités.

Réponds UNIQUEMENT en JSON valide :
{"title":"...","scenes":[{"index":1,"visualPrompt":"...","narration":"...","durationSec":${clipSec}}]}`;

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.75 }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = String(data.response || "");
  const clean = raw.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Réponse Ollama invalide (JSON attendu)");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) {
    throw new Error("Plan Ollama invalide");
  }
  return { ...parsed, scenes: parsed.scenes.slice(0, sceneCount) };
}

async function planScenesWithMistral({
  mistralKey,
  topic,
  durationMin,
  clipSec,
  aspectRatio,
  mistralModel
}) {
  const sceneCount = Math.ceil((durationMin * 60) / clipSec);
  const prompt = `Tu es un directeur de création vidéo YouTube. Génère un plan pour une vidéo ORIGINALE de ${durationMin} minutes.

Sujet : ${topic}
Format : ${aspectRatio}
Durée par scène : ${clipSec} secondes
Nombre de scènes EXACT : ${sceneCount}

Règles :
- Contenu 100% original, pas de logos, pas de visages de célébrités
- Prompts visuels cinématiques pour IA (silhouettes, ambiance, pas de texte à l'écran)
- Narration voix-off en français pour chaque scène
- Histoire cohérente du début à la fin

Réponds UNIQUEMENT en JSON valide :
{
  "title": "titre accrocheur",
  "scenes": [
    {
      "index": 1,
      "visualPrompt": "description visuelle détaillée en anglais pour IA vidéo",
      "narration": "texte voix-off français",
      "durationSec": ${clipSec}
    }
  ]
}`;

  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mistralKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: mistralModel || process.env.MISTRAL_PLANNER_MODEL || DEFAULT_MISTRAL_PLANNER_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.75,
      max_tokens: Math.min(16000, 400 + sceneCount * 120)
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mistral plan: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) {
    throw new Error("Plan de scènes invalide");
  }
  return { ...parsed, scenes: parsed.scenes.slice(0, sceneCount) };
}

function resolvePlannerMode(mode) {
  const value = String(mode || process.env.SULPHUR_PLANNER || "mistral").toLowerCase();
  if (["free", "template", "gratuit", "templates"].includes(value)) return "free";
  if (["ollama", "local-llm"].includes(value)) return "ollama";
  if (["mistral", "mistral-free", "mistral_free", "mistral-freetier"].includes(value)) return "mistral";
  return "mistral";
}

async function planScenes(options) {
  const plannerMode = resolvePlannerMode(options.plannerMode);

  if (plannerMode === "mistral") {
    const mistralKey = String(options.mistralKey || "").trim();
    if (!mistralKey) {
      if (process.env.SULPHUR_PLANNER_FALLBACK !== "0") {
        return buildFreePlan(options);
      }
      throw new Error(
        "Clé Mistral requise — créez-en une gratuitement sur https://console.mistral.ai (Free Tier, sans carte bancaire)"
      );
    }
    try {
      return await planScenesWithMistral({
        ...options,
        mistralKey,
        mistralModel: options.mistralModel || DEFAULT_MISTRAL_PLANNER_MODEL
      });
    } catch (error) {
      if (process.env.SULPHUR_PLANNER_FALLBACK !== "0") {
        return buildFreePlan(options);
      }
      throw error;
    }
  }

  if (plannerMode === "ollama") {
    try {
      return await planScenesWithOllama(options);
    } catch (error) {
      if (process.env.SULPHUR_PLANNER_FALLBACK !== "0") {
        return buildFreePlan(options);
      }
      throw error;
    }
  }

  return buildFreePlan(options);
}

function listPlanners() {
  return [
    {
      key: "mistral",
      label: "Mistral Free Tier (console.mistral.ai)",
      cost: "0€",
      model: DEFAULT_MISTRAL_PLANNER_MODEL,
      signup: "https://console.mistral.ai"
    },
    { key: "free", label: "Templates (aucune clé API)", cost: "0€" },
    { key: "ollama", label: "Ollama local (LLM gratuit)", cost: "0€" }
  ];
}

module.exports = {
  buildFreePlan,
  buildPlanFromScriptChunks,
  planScenes,
  planScenesFromScript,
  planScenesWithOllama,
  planScenesWithMistral,
  resolvePlannerMode,
  listPlanners,
  DEFAULT_MISTRAL_PLANNER_MODEL
};
