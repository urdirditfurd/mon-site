/**
 * Serveur minimal pour l'agent de prospection (mon-site ou repo standalone).
 */
const path = require("path");
const express = require("express");
const cors = require("cors");
const { createProspectionRouter } = require("./prospection-agent");

const PROSPECTION_DIR = path.resolve(__dirname, "..");
const PROSPECTION_HTML_PATH = path.join(PROSPECTION_DIR, "index.html");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "agent-prospection" });
});

app.use("/api/prospection", createProspectionRouter());

app.get("/prospection", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.sendFile(PROSPECTION_HTML_PATH);
});

app.use("/prospection", express.static(PROSPECTION_DIR, { index: false }));

app.get("/", (_req, res) => {
  res.redirect(302, "/prospection");
});

app.listen(PORT, HOST, () => {
  console.log(`Agent de prospection : http://${HOST}:${PORT}/prospection`);
  console.log(`Depuis l'extérieur : http://<IP-du-VPS>:${PORT}/prospection`);
});
