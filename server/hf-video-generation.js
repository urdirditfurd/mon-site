const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const PYTHON_BIN = process.env.CLIPFORGE_PYTHON_BIN || "python3";
const HF_VIDEO_WORKER_PATH = path.join(__dirname, "hf_text_to_video.py");

const HF_NEGATIVE_PROMPT =
  "Bright tones, overexposed, static, blurred details, subtitles, watermark, logo, celebrity face, text overlay, worst quality, low quality, jpeg artifacts, ugly, deformed, disfigured, poorly drawn hands, messy background";

const HF_VIDEO_PROFILES = {
  volume: {
    key: "volume",
    label: "Volume",
    modelId: process.env.CLIPFORGE_HF_MODEL_VOLUME || "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
    fps: 14,
    minFrames: 49,
    maxFrames: 65,
    numInferenceSteps: 14,
    guidanceScale: 5,
    defaultSceneDurationSec: 4,
    enableModelCpuOffload: true
  },
  balanced: {
    key: "balanced",
    label: "Equilibre",
    modelId: process.env.CLIPFORGE_HF_MODEL_BALANCED || "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
    fps: 15,
    minFrames: 65,
    maxFrames: 81,
    numInferenceSteps: 24,
    guidanceScale: 5.5,
    defaultSceneDurationSec: 5,
    enableModelCpuOffload: true
  },
  quality: {
    key: "quality",
    label: "Qualite",
    modelId: process.env.CLIPFORGE_HF_MODEL_QUALITY || "Wan-AI/Wan2.1-T2V-14B-Diffusers",
    fps: 15,
    minFrames: 81,
    maxFrames: 121,
    numInferenceSteps: 30,
    guidanceScale: 6,
    defaultSceneDurationSec: 6,
    enableModelCpuOffload: true
  }
};

function getAspectRatioDimensions(aspectRatio) {
  switch (aspectRatio) {
    case "1:1":
      return { width: 640, height: 640 };
    case "16:9":
      return { width: 832, height: 480 };
    case "9:16":
    default:
      return { width: 480, height: 832 };
  }
}

function sanitizePrompt(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1600);
}

function createDeterministicSeed(seedInput) {
  const raw = String(seedInput || Date.now());
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return Math.max(1, hash);
}

function resolveVideoGenerationProfile(profileKey, customModelId = "") {
  const resolvedKey = HF_VIDEO_PROFILES[profileKey] ? profileKey : "balanced";
  const profile = HF_VIDEO_PROFILES[resolvedKey];
  return {
    ...profile,
    modelId: String(customModelId || "").trim() || profile.modelId
  };
}

function resolveFrameCount(sceneDurationSec, profile) {
  const requestedFrames = Math.round(Math.max(1, Number(sceneDurationSec) || profile.defaultSceneDurationSec) * profile.fps) + 1;
  return Math.max(profile.minFrames, Math.min(profile.maxFrames, requestedFrames));
}

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [HF_VIDEO_WORKER_PATH], {
      cwd: path.dirname(HF_VIDEO_WORKER_PATH),
      env: {
        ...process.env,
        HF_HUB_DISABLE_TELEMETRY: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      reject(error);
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `hf_text_to_video.py exit ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim() || "{}");
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Réponse JSON invalide du worker Hugging Face: ${error.message}`));
      }
    });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

async function generateVideoWithHuggingFace({
  prompt,
  aspectRatio = "9:16",
  outputPath,
  profile = "balanced",
  customModelId = "",
  hfApiToken = "",
  sceneDurationSec,
  seedInput,
  negativePrompt = HF_NEGATIVE_PROMPT
}) {
  const resolvedProfile = resolveVideoGenerationProfile(profile, customModelId);
  const { width, height } = getAspectRatioDimensions(aspectRatio);
  const targetPath = path.resolve(outputPath);
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });

  const payload = {
    model_id: resolvedProfile.modelId,
    prompt: sanitizePrompt(prompt),
    negative_prompt: sanitizePrompt(negativePrompt),
    width,
    height,
    fps: resolvedProfile.fps,
    num_frames: resolveFrameCount(sceneDurationSec, resolvedProfile),
    num_inference_steps: resolvedProfile.numInferenceSteps,
    guidance_scale: resolvedProfile.guidanceScale,
    enable_model_cpu_offload: resolvedProfile.enableModelCpuOffload,
    seed: createDeterministicSeed(seedInput),
    output_path: targetPath,
    hf_token: String(hfApiToken || process.env.HF_TOKEN || "").trim()
  };

  const workerResult = await runWorker(payload);
  if (!fs.existsSync(targetPath)) {
    throw new Error("Le worker Hugging Face a terminé sans produire de fichier vidéo.");
  }

  return {
    ...workerResult,
    outputPath: targetPath,
    profileKey: resolvedProfile.key,
    profileLabel: resolvedProfile.label,
    modelId: resolvedProfile.modelId,
    width,
    height,
    fps: resolvedProfile.fps
  };
}

module.exports = {
  HF_NEGATIVE_PROMPT,
  HF_VIDEO_PROFILES,
  generateVideoWithHuggingFace,
  resolveVideoGenerationProfile
};
