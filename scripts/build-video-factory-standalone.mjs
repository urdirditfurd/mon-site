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
const generationMontageDir = path.join(root, "generation-montage-export");
const generationMontageIndex = path.join(generationMontageDir, "index.html");

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
fs.mkdirSync(generationMontageDir, { recursive: true });
fs.writeFileSync(outPath, html, "utf8");
fs.writeFileSync(downloadsPath, html, "utf8");
fs.writeFileSync(generationMontageIndex, html, "utf8");

const readme = `# Generation Montage

Interface **tout-en-un** pour transformer un script en vidéo (images IA + montage).

## Ouvrir l'interface (avec le design)

**Ne pas ouvrir** \`video-factory.html\` seul (page blanche sans style).

1. Téléchargez ou clonez ce repo
2. Double-cliquez sur **\`index.html\`** (CSS + JS inclus)
3. Lancez le serveur dans le dossier complet du projet :
   \`\`\`bash
   npm install
   npm start
   \`\`\`
4. Dans l'app, URL serveur : \`http://localhost:3000\` → **Générer**

## Lien direct navigateur (fichier local)

Ouvrez \`index.html\` depuis ce dossier — fond sombre, interface complète.

## Token Hugging Face (gratuit)

https://huggingface.co/settings/tokens → créer un token **Read**

## Repo complet (serveur + API)

https://github.com/urdirditfurd/mon-site (branche fiction-studio)
`;

fs.writeFileSync(path.join(generationMontageDir, "README.md"), readme, "utf8");

console.log(`✓ ${outPath}`);
console.log(`✓ ${downloadsPath}`);
console.log(`✓ ${generationMontageIndex}`);
console.log(`✓ ${path.join(generationMontageDir, "README.md")}`);
