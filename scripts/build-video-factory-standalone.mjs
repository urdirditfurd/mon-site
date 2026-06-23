#!/usr/bin/env node
/**
 * Génère un fichier HTML unique pour copier dans Downloads (ex. index (3).html)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const htmlPath = path.join(root, "video-factory.html");
const cssPath = path.join(root, "video-factory.css");
const jsPath = path.join(root, "video-factory.js");
const outPath = path.join(root, "video-factory-standalone.html");
const downloadsPath = path.join(root, "downloads", "index-video-studio.html");

let html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");

html = html.replace(
  /<link rel="stylesheet" href="video-factory\.css">/,
  `<style>\n${css}\n</style>`
);
html = html.replace(
  /<script src="video-factory\.js"><\/script>/,
  `<script>\n${js}\n</script>`
);

fs.mkdirSync(path.dirname(downloadsPath), { recursive: true });
fs.writeFileSync(outPath, html, "utf8");
fs.writeFileSync(downloadsPath, html, "utf8");

console.log(`✓ ${outPath}`);
console.log(`✓ ${downloadsPath}`);
