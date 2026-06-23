const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const {
  generateSceneClip,
  runFfmpegConcat,
  resolveFalModel,
  resolveHfVideoModel,
  resolveVideoProvider,
  DEFAULT_FAL_MODEL,
  DEFAULT_VIDEO_PROVIDER
} = require("./voanh-video-pipeline");

const FAL_CLIP_SEC = 10;

function falDurationForScene(durationSec) {
  const sec = Math.max(5, Math.min(FAL_CLIP_SEC, Math.round(durationSec)));
  return sec <= 7 ? "5" : "10";
}

async function planViralScriptsWithMistral({
  mistralKey,
  sourceTranscript,
  sourceTitle,
  clipsCount,
  clipDurationSec,
  aspectRatio,
  mistralModel
}) {
  const scenesPerScript = Math.max(1, Math.ceil(clipDurationSec / FAL_CLIP_SEC));
  const prompt = `Tu es un expert en contenus viraux TikTok et YouTube Shorts (style Cortisia / faceless viral).

Vidéo source : ${sourceTitle || "contenu inspirant"}
Transcript source (inspiration uniquement — crée du contenu 100 % ORIGINAL, ne copie pas mot pour mot) :
"""
${String(sourceTranscript || "").slice(0, 14000)}
"""

Génère EXACTEMENT ${clipsCount} scripts de shorts viraux (~${clipDurationSec}s chacun).
Format cible : ${aspectRatio}

Règles :
- Hook fort dans les 2 premières secondes
- Narration voix-off en français (pour sous-titres)
- Visuels cinématiques IA en anglais (pas de logos, pas de célébrités reconnaissables, pas de texte à l'écran)
- Chaque script = ${scenesPerScript} scène(s) de ~${FAL_CLIP_SEC}s max
- Ton énergique, rythme court, idéal YouTube Shorts

Réponds UNIQUEMENT en JSON valide :
{
  "scripts": [
    {
      "title": "titre accrocheur du short",
      "hook": "phrase d'accroche",
      "narration": "texte complet du short en français",
      "hashtags": ["#shorts", "#viral"],
      "scenes": [
        {
          "index": 1,
          "visualPrompt": "detailed cinematic visual in English for AI video",
          "narration": "segment voix-off français pour cette scène",
          "durationSec": ${FAL_CLIP_SEC}
        }
      ]
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
      model: mistralModel || "mistral-small-2506",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: Math.min(16000, 800 + clipsCount * scenesPerScript * 150)
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Mistral scripts: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed.scripts) || !parsed.scripts.length) {
    throw new Error("Scripts viraux invalides (Mistral)");
  }

  return parsed.scripts.slice(0, clipsCount).map((script, index) => {
    const scenes = Array.isArray(script.scenes) ? script.scenes : [];
    const normalizedScenes =
      scenes.length > 0
        ? scenes.slice(0, scenesPerScript)
        : [
            {
              index: 1,
              visualPrompt: script.visualPrompt || "Cinematic abstract motion, dramatic lighting, no text",
              narration: script.narration || script.hook || "",
              durationSec: FAL_CLIP_SEC
            }
          ];
    return {
      title: String(script.title || script.hook || `Short viral ${index + 1}`).trim(),
      hook: String(script.hook || "").trim(),
      narration: String(script.narration || normalizedScenes.map((s) => s.narration).join(" ")).trim(),
      hashtags: Array.isArray(script.hashtags) ? script.hashtags : [],
      scenes: normalizedScenes.map((scene, sceneIndex) => ({
        index: sceneIndex + 1,
        visualPrompt: String(scene.visualPrompt || script.visualPrompt || "Cinematic viral short scene").trim(),
        narration: String(scene.narration || "").trim(),
        durationSec: Math.max(5, Math.min(FAL_CLIP_SEC, Number(scene.durationSec) || FAL_CLIP_SEC))
      }))
    };
  });
}

async function processAiRemixJob(job, ctx) {
  const {
    jobDir,
    persistJobsDb,
    getJobSrtPath,
    getJobCaptionsBurnPath,
    getJobPlanPath,
    writeJobBundleZip,
    buildCaptionsForClip,
    prepareCaptionsForBurn,
    captionsToSrt,
    burnCaptionsIntoClip,
    replaceClipAudioWithBackgroundMusic,
    transcribeVideoMaybe,
    parseSubtitleFileToTimedCaptions,
    COPYRIGHT_SHIELD_BG_MUSIC,
    boolFrom,
    DEFAULTS
  } = ctx;

  const mistralKey = String(job.aiSecrets?.mistralApiKey || "").trim();
  const falKey = String(job.aiSecrets?.falApiKey || "").trim();
  if (!mistralKey) throw new Error("Clé API Mistral requise pour le mode Remix IA");
  const videoProvider = resolveVideoProvider(job.params.videoProvider || DEFAULT_VIDEO_PROVIDER);
  if (videoProvider === "fal" && !falKey) {
    throw new Error("Clé API FAL requise pour le mode Remix IA");
  }

  const falModel = resolveFalModel(job.params.falModel || DEFAULT_FAL_MODEL);
  const hfModel = resolveHfVideoModel(job.params.hfModel);
  const mistralModel = job.params.mistralModel || "mistral-small-2506";

  job.params.burnSubtitles = true;
  job.params.includeAutoTranscript = true;
  if (!job.params.subtitleTheme) job.params.subtitleTheme = "shorts";

  let sourceTimedCaptions = [];
  if (job.sourceSubtitlePath) {
    try {
      sourceTimedCaptions = await parseSubtitleFileToTimedCaptions(job.sourceSubtitlePath);
    } catch {
      sourceTimedCaptions = [];
    }
  }

  if (!job.params.transcript && job.params.includeAutoTranscript) {
    const generated = await transcribeVideoMaybe(job.inputPath, job.duration, true);
    job.params.transcript = generated.transcript;
    job.autoTranscriptUsed = generated.autoTranscriptUsed;
  }

  if (!job.params.transcript && sourceTimedCaptions.length) {
    job.params.transcript = sourceTimedCaptions.map((cue) => cue.text).join(" ");
  }

  const sourceTranscript = String(job.params.transcript || "").trim();
  if (sourceTranscript.length < 40) {
    throw new Error(
      "Transcript source trop court. Active la transcription auto ou fournis une vidéo avec sous-titres YouTube."
    );
  }

  job.progress = 20;
  job.aiRemixStage = "Génération des scripts viraux (Mistral)…";
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();

  const scripts = await planViralScriptsWithMistral({
    mistralKey,
    sourceTranscript,
    sourceTitle: job.originalFilename,
    clipsCount: job.params.clipsCount,
    clipDurationSec: job.params.clipDuration,
    aspectRatio: job.params.aspectRatio,
    mistralModel
  });

  job.progress = 30;
  job.aiRemixStage = `${scripts.length} scripts prêts — génération vidéo IA (${videoProvider === "huggingface-local" ? "Hugging Face" : "FAL"})…`;
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();

  const totalScenes = scripts.reduce((sum, script) => sum + script.scenes.length, 0);
  let completedScenes = 0;
  const rendered = [];

  for (let scriptIndex = 0; scriptIndex < scripts.length; scriptIndex += 1) {
    const script = scripts[scriptIndex];
    const clipId = `clip-${scriptIndex + 1}`;
    const clipDir = path.join(jobDir, clipId);
    await fsp.mkdir(clipDir, { recursive: true });

    const localScenePaths = [];
    for (let sceneIndex = 0; sceneIndex < script.scenes.length; sceneIndex += 1) {
      const scene = script.scenes[sceneIndex];
      job.aiRemixStage = `Short ${scriptIndex + 1}/${scripts.length} — scène ${sceneIndex + 1}/${script.scenes.length} (FAL)`;
      job.updatedAt = new Date().toISOString();
      await persistJobsDb();

      const scenePath = path.join(clipDir, `scene-${String(sceneIndex + 1).padStart(2, "0")}.mp4`);
      await generateSceneClip({
        provider: videoProvider,
        falKey,
        falModelPath: falModel,
        hfModel,
        scene: {
          ...scene,
          durationSec: falDurationForScene(scene.durationSec)
        },
        aspectRatio: job.params.aspectRatio,
        destPath: scenePath
      });
      localScenePaths.push(scenePath);
      completedScenes += 1;
      job.progress = 30 + Math.round((completedScenes / Math.max(1, totalScenes)) * 55);
      job.updatedAt = new Date().toISOString();
      await persistJobsDb();
    }

    let assembledPath = path.join(clipDir, `${clipId}-assembled.mp4`);
    if (localScenePaths.length === 1) {
      assembledPath = localScenePaths[0];
    } else {
      const listPath = path.join(clipDir, "concat.txt");
      const listContent = localScenePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
      await fsp.writeFile(listPath, listContent, "utf8");
      await runFfmpegConcat(listPath, assembledPath);
    }

    const narrationText = script.narration || script.scenes.map((s) => s.narration).join(" ");
    const clipDuration = job.params.clipDuration;
    const captions = buildCaptionsForClip(clipDuration, narrationText);
    const displayCaptions = prepareCaptionsForBurn(captions, job.params.subtitleTheme);
    const srtPath = getJobSrtPath(job.id, clipId);
    await fsp.writeFile(srtPath, captionsToSrt(displayCaptions), "utf8");

    let finalClipPath = assembledPath;
    const wantsMusic =
      boolFrom(job.params.backgroundMusic, DEFAULTS.backgroundMusic) && fs.existsSync(COPYRIGHT_SHIELD_BG_MUSIC);
    if (wantsMusic) {
      const musicPath = path.join(clipDir, `${clipId}-music.mp4`);
      await replaceClipAudioWithBackgroundMusic(assembledPath, musicPath);
      finalClipPath = musicPath;
    }

    let burnedFilePath = null;
    if (job.params.burnSubtitles) {
      const burnPath = getJobCaptionsBurnPath(job.id, clipId);
      try {
        await burnCaptionsIntoClip(finalClipPath, srtPath, burnPath, job.params.subtitleTheme);
        burnedFilePath = burnPath;
      } catch {
        burnedFilePath = null;
      }
    }

    rendered.push({
      id: clipId,
      title: script.title,
      start: 0,
      end: clipDuration,
      duration: clipDuration,
      score: Number((0.95 - scriptIndex * 0.02).toFixed(4)),
      filePath: finalClipPath,
      dubbedAudioPath: "",
      dubVoice: "",
      burnedFilePath,
      srtPath,
      captions: displayCaptions,
      aspectRatio: job.params.aspectRatio,
      aiScript: {
        hook: script.hook,
        narration: script.narration,
        hashtags: script.hashtags
      }
    });
  }

  job.clips = rendered;
  job.progress = 95;
  job.aiRemixStage = "Finalisation…";
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();

  const plan = {
    id: job.id,
    createdAt: job.createdAt,
    mode: "ai-remix",
    source: { filename: job.originalFilename, duration: job.duration, url: job.sourceUrl },
    params: { ...job.params, mistralApiKey: undefined, falApiKey: undefined },
    autoTranscriptUsed: !!job.autoTranscriptUsed,
    scripts: rendered.map((clip) => ({
      id: clip.id,
      title: clip.title,
      hook: clip.aiScript?.hook,
      narration: clip.aiScript?.narration,
      hashtags: clip.aiScript?.hashtags,
      captions: clip.captions
    }))
  };
  await fsp.writeFile(getJobPlanPath(job.id), JSON.stringify(plan, null, 2), "utf8");

  try {
    await writeJobBundleZip(job);
  } catch {
    // ZIP non bloquant
  }

  job.status = "completed";
  job.progress = 100;
  job.aiRemixStage = "Terminé";
  job.updatedAt = new Date().toISOString();
  delete job.aiSecrets;
  await persistJobsDb();
}

module.exports = {
  planViralScriptsWithMistral,
  processAiRemixJob,
  FAL_CLIP_SEC
};
