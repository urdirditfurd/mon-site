/**
 * Montage FFmpeg : images → clips Ken Burns → concat → musique → sous-titres.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { DEFAULT_FPS, resolutionForAspect } = require("./hf-image-models");

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-1200)}`));
        return;
      }
      resolve();
    });
  });
}

function formatSrtTimestamp(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function buildSrtFromScenes(scenes, fps = DEFAULT_FPS) {
  let cursorMs = 0;
  const cues = [];

  for (const scene of scenes || []) {
    const durationSec = Number(scene.durationSec) || 4;
    const text = String(scene.narration || scene.caption || "").trim();
    if (text) {
      cues.push({
        start: cursorMs,
        end: cursorMs + Math.round(durationSec * 1000),
        text
      });
    }
    cursorMs += Math.round(durationSec * 1000);
  }

  return cues
    .map((cue, idx) => {
      const start = formatSrtTimestamp(cue.start);
      const end = formatSrtTimestamp(cue.end);
      return `${idx + 1}\n${start} --> ${end}\n${cue.text}\n`;
    })
    .join("\n");
}

function subtitleForceStyle(theme) {
  if (theme === "shorts") {
    return "Fontname=Arial,Fontsize=28,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=1,Shadow=0,BackColour=&H50000000&,Bold=0,Alignment=2,MarginV=48,MarginL=48,MarginR=48,WrapStyle=2";
  }
  if (theme === "cinema") {
    return "Fontname=Georgia,Fontsize=24,PrimaryColour=&H00F0F0F0&,BackColour=&H70000000&,Outline=2,Alignment=2,MarginV=56";
  }
  return "Fontname=Arial,Fontsize=22,PrimaryColour=&H00FFFFFF&,BackColour=&H80000000&,Outline=1,Alignment=2,MarginV=48";
}

function buildKenBurnsFilter({ width, height, fps, durationSec, motion = "zoom-in" }) {
  const frames = Math.max(1, Math.round(durationSec * fps));
  const zoomExpr =
    motion === "zoom-out"
      ? "if(lte(zoom,1.0),1.5,max(1.0,zoom-0.0015))"
      : "min(zoom+0.0012,1.18)";
  const panX = motion === "pan-left" ? "x+1" : motion === "pan-right" ? "x-1" : "iw/2-(iw/zoom/2)";
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `zoompan=z='${zoomExpr}':x='${panX}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
    "format=yuv420p"
  ].join(",");
}

async function imageToVideoClip({
  imagePath,
  outputPath,
  durationSec,
  aspectRatio,
  fps = DEFAULT_FPS,
  motion
}) {
  const { width, height } = resolutionForAspect(aspectRatio);
  const vf = buildKenBurnsFilter({ width, height, fps, durationSec, motion });
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await runCommand("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-vf",
    vf,
    "-t",
    String(durationSec),
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    process.env.FFMPEG_PRESET || "veryfast",
    "-crf",
    String(process.env.FFMPEG_CRF || 23),
    "-pix_fmt",
    "yuv420p",
    "-an",
    outputPath
  ]);
  return outputPath;
}

async function concatVideoClips(clipPaths, outputPath) {
  const listPath = `${outputPath}.txt`;
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await fsp.writeFile(listPath, listContent, "utf8");
  await runCommand("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath
  ]);
  await fsp.unlink(listPath).catch(() => {});
  return outputPath;
}

async function muxBackgroundMusic(videoPath, musicPath, outputPath, volume = 0.35) {
  if (!musicPath || !fs.existsSync(musicPath)) {
    await fsp.copyFile(videoPath, outputPath);
    return outputPath;
  }
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-stream_loop",
    "-1",
    "-i",
    musicPath,
    "-filter_complex",
    `[1:a]volume=${volume}[music];[music]afade=t=out:st=0:d=0.5[a]`,
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outputPath
  ]);
  return outputPath;
}

async function burnSubtitles(videoPath, srtPath, outputPath, theme = "cinema", aspectRatio = "9:16") {
  const { width, height } = resolutionForAspect(aspectRatio);
  const escapedSrt = srtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  const vf = `subtitles='${escapedSrt}':original_size=${width}x${height}:force_style='${subtitleForceStyle(theme)}'`;
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    process.env.FFMPEG_PRESET || "veryfast",
    "-crf",
    String(process.env.FFMPEG_CRF || 23),
    "-c:a",
    "copy",
    outputPath
  ]);
  return outputPath;
}

async function muxNarrationAudio(videoPath, audioPath, outputPath, backgroundMusicPath) {
  const hasMusic = backgroundMusicPath && fs.existsSync(backgroundMusicPath);
  if (!audioPath || !fs.existsSync(audioPath)) {
    if (hasMusic) return muxBackgroundMusic(videoPath, backgroundMusicPath, outputPath);
    await fsp.copyFile(videoPath, outputPath);
    return outputPath;
  }

  if (!hasMusic) {
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      outputPath
    ]);
    return outputPath;
  }

  await runCommand("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-stream_loop",
    "-1",
    "-i",
    backgroundMusicPath,
    "-filter_complex",
    "[1:a]volume=1[voice];[2:a]volume=0.18[music];[voice][music]amix=inputs=2:duration=first[a]",
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outputPath
  ]);
  return outputPath;
}

const MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right"];

function motionForScene(index) {
  return MOTIONS[index % MOTIONS.length];
}

module.exports = {
  DEFAULT_FPS,
  buildSrtFromScenes,
  imageToVideoClip,
  concatVideoClips,
  muxBackgroundMusic,
  burnSubtitles,
  muxNarrationAudio,
  motionForScene,
  runCommand
};
