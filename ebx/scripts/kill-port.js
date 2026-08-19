/**
 * Libère un port (Windows / Linux / macOS) — utile si EADDRINUSE sur :3000.
 * Usage: node scripts/kill-port.js [port]
 */
const { execSync } = require("child_process");

const port = String(process.argv[2] || process.env.PORT || 3000).replace(/\D/g, "") || "3000";

function killWindows() {
  let out = "";
  try {
    out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
  } catch {
    console.log(`[kill-port] Aucun processus trouvé sur le port ${port}.`);
    return 0;
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
  }
  if (!pids.size) {
    console.log(`[kill-port] Aucun listener LISTENING sur ${port}.`);
    return 0;
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "inherit" });
      console.log(`[kill-port] Processus ${pid} arrêté (port ${port}).`);
    } catch (err) {
      console.warn(`[kill-port] Impossible d'arrêter PID ${pid}:`, err.message);
    }
  }
  return pids.size;
}

function killUnix() {
  let out = "";
  try {
    out = execSync(`lsof -ti :${port}`, { encoding: "utf8" });
  } catch {
    console.log(`[kill-port] Aucun processus trouvé sur le port ${port}.`);
    return 0;
  }
  const pids = [...new Set(out.split(/\s+/).filter(Boolean))];
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`[kill-port] Processus ${pid} arrêté (port ${port}).`);
    } catch (err) {
      console.warn(`[kill-port] Impossible d'arrêter PID ${pid}:`, err.message);
    }
  }
  return pids.length;
}

const n = process.platform === "win32" ? killWindows() : killUnix();
console.log(`[kill-port] Terminé — ${n} processus traité(s). Tu peux lancer: npm start`);
