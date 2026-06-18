const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let bundledPath = "";

try {
  const constants = require("youtube-dl-exec/src/constants");
  bundledPath = String(constants.YOUTUBE_DL_PATH || "").trim();
} catch {
  bundledPath = "";
}

function checkExecutable(executable, testArgs = ["--version"]) {
  if (!executable) return false;
  const result = spawnSync(executable, testArgs, { stdio: "ignore" });
  return result.status === 0;
}

function checkPythonModule() {
  const result = spawnSync("python3", ["-m", "yt_dlp", "--version"], { stdio: "ignore" });
  return result.status === 0;
}

function resolveSystemYtDlpBinary() {
  if (checkExecutable("yt-dlp", ["--version"])) return "yt-dlp";

  const home = process.env.HOME || process.env.USERPROFILE || "";
  const localBin = path.join(home, ".local", "bin", "yt-dlp");
  if (localBin && fs.existsSync(localBin) && checkExecutable(localBin, ["--version"])) {
    return localBin;
  }

  return "";
}

function resolveYtDlpInvocation() {
  if (bundledPath && fs.existsSync(bundledPath) && checkExecutable(bundledPath, ["--version"])) {
    return { executable: bundledPath, viaPython: false, source: "bundled" };
  }

  const systemBinary = resolveSystemYtDlpBinary();
  if (systemBinary) {
    return { executable: systemBinary, viaPython: false, source: "system" };
  }

  if (checkPythonModule()) {
    return { executable: "python3", viaPython: true, source: "python-module" };
  }

  return { executable: "", viaPython: false, source: "none" };
}

function isYtDlpAvailable() {
  return Boolean(resolveYtDlpInvocation().executable);
}

function buildYtDlpArgs(baseArgs) {
  const invocation = resolveYtDlpInvocation();
  if (!invocation.executable) {
    throw new Error("yt-dlp indisponible");
  }
  if (invocation.viaPython) {
    return { executable: invocation.executable, args: ["-m", "yt_dlp", ...baseArgs] };
  }
  return { executable: invocation.executable, args: baseArgs };
}

function getYtDlpSource() {
  return resolveYtDlpInvocation().source;
}

module.exports = {
  isYtDlpAvailable,
  buildYtDlpArgs,
  getYtDlpSource,
  resolveYtDlpInvocation
};
