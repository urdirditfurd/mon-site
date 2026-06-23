const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { planViralScriptsFromTranscript } = require("./ai-storyboard");
const { runFfmpegConcat } = require("./voanh-video-pipeline");
const { generateVideoWithHuggingFace, resolveVideoGenerationProfile } = require("./hf-video-generation");

function resolveSceneDuration(clipDurationSec, profileKey, customModelId) {
  const profile = resolveVideoGenerationProfile(profileKey, customModelId);
  return Math.max(4, Math.min(profile.defaultSceneDurationSec, Math.max(4, Math.round(clipDurationSec))));
}

function createSceneSeed(jobId, scriptIndex, sceneIndex) {
  return `${jobId}:${scriptIndex + 1}:${sceneIndex + 1}`;
}

async function planViralScriptsWithMistral({
  sourceTranscript,
  sourceTitle,
  clipsCount,
  clipDurationSec,
  aspectRatio,
  videoGenerationProfile,
  videoModelId
}) {
  const sceneDurationSec = resolveSceneDuration(clipDurationSec, videoGenerationProfile, videoModelId);
  return planViralScriptsFromTranscript({
    sourceTranscript,
    sourceTitle,
    clipsCount,
    clipDurationSec,
    aspectRatio,
    sceneDurationSec
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

  const hfApiToken = String(job.aiSecrets?.hfApiToken || "").trim();
  const videoGenerationProfile = String(job.params.videoGenerationProfile || "balanced").trim();
  const videoModelId = String(job.params.videoModelId || "").trim();
  const resolvedProfile = resolveVideoGenerationProfile(videoGenerationProfile, videoModelId);

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
  job.aiRemixStage = "Construction du storyboard viral (local)…";
  job.updatedAt = new Date().toISOString();
  await persistJobsDb();

  const scripts = await planViralScriptsWithMistral({
    sourceTranscript,
    sourceTitle: job.originalFilename,
    clipsCount: job.params.clipsCount,
    clipDurationSec: job.params.clipDuration,
    aspectRatio: job.params.aspectRatio,
    videoGenerationProfile,
    videoModelId
  });

  job.progress = 30;
  job.aiRemixStage = `${scripts.length} scripts prêts — génération vidéo IA Hugging Face (${resolvedProfile.label})…`;
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
      job.aiRemixStage = `Short ${scriptIndex + 1}/${scripts.length} — scène ${sceneIndex + 1}/${script.scenes.length} (${resolvedProfile.modelId})`;
      job.updatedAt = new Date().toISOString();
      await persistJobsDb();

      const scenePath = path.join(clipDir, `scene-${String(sceneIndex + 1).padStart(2, "0")}.mp4`);
      await generateVideoWithHuggingFace({
        prompt: scene.visualPrompt,
        aspectRatio: job.params.aspectRatio,
        outputPath: scenePath,
        profile: videoGenerationProfile,
        customModelId: videoModelId,
        hfApiToken,
        sceneDurationSec: scene.durationSec,
        seedInput: createSceneSeed(job.id, scriptIndex, sceneIndex)
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
    params: { ...job.params, hfApiToken: undefined },
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
  FAL_CLIP_SEC: 5
};
