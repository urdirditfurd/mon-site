/**
 * Customisation pré-publication — neuromarketing / copywriting conversion.
 * Tri des données déjà présentes (listing DB) → copy irrésistible → HTML → badge 1ʳᵉ image.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sanitizeListingHtml, scrubWhySectionInHtml } = require("./scraper");
const {
  CACHE_DIR,
  chromeLaunchOpts,
  extractAllImageSrcs,
  resolveLocalMediaPath,
  publicMediaPath,
  ensureCacheDir,
} = require("./image-cache");

/** Lazy — parse JSON sans charger openai au require des tests. */
function cleanAndParseJSON(responseText) {
  try {
    const { cleanAndParseJSON: parse } = require("./ai-brain");
    return parse(responseText);
  } catch (_) {
    try {
      const raw = String(responseText || "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end <= start) return { _parse_error: true };
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return { _parse_error: true };
    }
  }
}

async function callNeuroLLM(messages, { temperature = 0.65, max_tokens = 1800 } = {}) {
  const OpenAI = require("openai");
  const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || "http://localhost:1234/v1";
  const client = new OpenAI({ baseURL: LOCAL_LLM_URL, apiKey: "not-needed" });
  return client.chat.completions.create({
    model: "local-model",
    messages,
    temperature,
    max_tokens,
  });
}

const NEURO_SYSTEM = `Agis comme un Directeur Commercial de classe mondiale, expert en neuromarketing, en psychologie comportementale et en copywriting de conversion (AIDA et PAS).

Ta mission : Transformer une fiche produit basique et "lambda" en une annonce irrésistible, optimisée pour maximiser le CTR et le taux de conversion. Adapte-toi à la nature du produit (urgence/tech pour un PC ; prestige/sensoriel pour un stylo ; chaleureux pour maison/famille).

Tu génères le contenu des 7 blocs ci-dessous, puis tu les sers UNIQUEMENT en JSON valide (pas de markdown autour).

1. TITRES "AIMANT À CLICS" : formule [Bénéfice/Émotion] + [Produit] + [Preuve/Urgence]. Max 60 caractères. Mots de puissance (Révolutionnaire, Ultime, Exclusif, Secret).
2. VISUEL : palette HEX (primaire = émotion/désir, CTA = action/urgence) + badge court pour la 1ʳᵉ image produit.
3. ACCROCHE PAIN POINT : 2 lignes empathiques puis autoritaires (frustration → seule solution logique).
4. CORPS : 3 bullets Feature → Benefit → Feeling (bénéfices émotionnels, pas de jargon technique sec).
5. RÉASSURANCE : 2 phrases qui brisent les freins de la catégorie (casse, obsolescence, qualité) + garantie/satisfaction.
6. CTA : 2 textes bouton — INTERDICTION « Acheter » / « Valider » ; verbes orientés bénéfice.
7. STORYTELLING : 1 phrase sensorielle post-achat (5 sens).

RÈGLES D'OR :
- Zéro jargon inutile. Zéro mensonge. Zéro noms Amazon/AliExpress/Cdiscount/eBay.
- Ton adapté à la catégorie.
- Réponds UNIQUEMENT avec un objet JSON valide.

Format JSON STRICT :
{
  "titles": ["titre1 max 60 car", "titre2 max 60 car", "titre3 max 60 car"],
  "seo_title": "meilleur titre retenu max 80 car (eBay)",
  "visual": {
    "primary_hex": "#RRGGBB",
    "primary_why": "justification courte",
    "cta_hex": "#RRGGBB",
    "cta_why": "justification courte",
    "badge": "texte badge court (ex: Best-Seller)"
  },
  "hook": "2 phrases accroche pain point → solution",
  "benefits": [
    "Feature → Benefit → Feeling (phrase complète)",
    "Feature → Benefit → Feeling",
    "Feature → Benefit → Feeling"
  ],
  "reassurance": ["phrase réassurance 1", "phrase réassurance 2"],
  "ctas": ["CTA bouton 1 sans Acheter/Valider", "CTA bouton 2"],
  "story": "1 phrase sensorielle post-achat",
  "short_pitch": "1 phrase sous le titre"
}`;

/**
 * Infère une catégorie lisible depuis titre / mots-clés / description.
 */
function inferCategory(blob = "") {
  const t = String(blob || "").toLowerCase();
  if (/pc|laptop|ordinateur|gpu|ssd|clavier|souris gaming|chargeur|usb|cable|câble|led|rgb/.test(t)) {
    return "High-Tech / Accessoires";
  }
  if (/stylo|pen|écriture|carnet|papier|cahier/.test(t)) return "Papeterie / Écriture";
  if (/chien|chat|animal|pet|gamelle|laisse|jouet chat|jouet chien/.test(t)) return "Animaux";
  if (/sport|yoga|musculation|fitness|corde|bande elastique|gourde/.test(t)) return "Sport / Fitness";
  if (/maison|cuisine|rangement|lampe|bureau|tapis|oreiller|spa|maquillage|beaute|beauté/.test(t)) {
    return "Maison / Lifestyle";
  }
  if (/outil|tournevis|bricolage|ventouse|pate thermique|thermique/.test(t)) return "Bricolage / Outillage";
  if (/enfant|jouet|bebe|bébé/.test(t)) return "Enfants / Jouets";
  return "Général / Lifestyle";
}

function htmlToPlain(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractBulletsFromHtml(html) {
  const out = [];
  const li = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = li.exec(String(html || ""))) && out.length < 10) {
    const t = htmlToPlain(m[1]).replace(/^✔\s*/, "").trim();
    if (t && t.length > 8 && !/source\s*:|aliexpress|amazon|cdiscount/i.test(t)) out.push(t);
  }
  return out;
}

/**
 * Tri des données déjà en place dans le listing EBX → inputs du prompt.
 */
function triageListingInputs(listing = {}) {
  const name = String(listing.seo_title || listing.title || "Produit").trim().slice(0, 120);
  const plain = htmlToPlain(listing.html_description || "");
  const bullets = extractBulletsFromHtml(listing.html_description);
  const keywords = String(listing.keywords || "").replace(/^auto-publish:/i, "").trim();
  const category = inferCategory(`${name} ${keywords} ${plain.slice(0, 400)}`);
  const price = Number(listing.suggested_price) || 0;
  const cost = Number(listing.cost_price) || 0;
  const descriptionParts = [];
  if (bullets.length) descriptionParts.push(bullets.slice(0, 6).map((b) => `• ${b}`).join("\n"));
  if (plain) descriptionParts.push(plain.slice(0, 900));
  if (keywords) descriptionParts.push(`Mots-clés: ${keywords}`);
  return {
    name,
    category,
    description: descriptionParts.join("\n\n").slice(0, 1400) || name,
    price,
    cost,
    language: "fr",
    images: extractAllImageSrcs(listing.html_description || "").filter((s) => /^\/media\//i.test(s)),
  };
}

function clipTitle(s, max = 80) {
  let t = String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[«»""]/g, "")
    .slice(0, max);
  if (t.length === max) {
    const cut = t.lastIndexOf(" ");
    const minKeep = Math.max(12, Math.floor(max * 0.45));
    if (cut >= minKeep) t = t.slice(0, cut);
  }
  return t.trim();
}

function fallbackNeuroCopy(inputs) {
  const name = clipTitle(inputs.name, 48);
  const cat = inputs.category || "Lifestyle";
  const isTech = /tech|high-tech|usb|pc|led/i.test(cat);
  const isSport = /sport|fitness/i.test(cat);
  const primary = isTech ? "#1e3a5f" : isSport ? "#0f766e" : "#3b2f2f";
  const cta = isTech ? "#f97316" : isSport ? "#22c55e" : "#e11d48";
  const badge = isTech ? "Best-Seller" : isSport ? "Performance" : "Choix clients";
  const titles = [
    clipTitle(`Ultime ${name} — Confort immédiat`, 60),
    clipTitle(`Secret des pros : ${name}`, 60),
    clipTitle(`${name} exclusif, prêt à l’emploi`, 60),
  ];
  return {
    titles,
    seo_title: clipTitle(titles[0], 80),
    visual: {
      primary_hex: primary,
      primary_why: isTech ? "Bleu profond = confiance tech" : isSport ? "Teal = énergie durable" : "Brun chaud = confort maison",
      cta_hex: cta,
      cta_why: isTech ? "Orange = impulsion d’achat" : isSport ? "Vert = go / sécurité" : "Rouge rose = désir",
      badge,
    },
    hook: `Marre des produits fragiles qui déçoivent dès la première semaine ? ${name} est conçu pour tenir la distance — simple, efficace, sans compromis.`,
    benefits: [
      `Qualité soignée → un usage fluide au quotidien → vous gagnez du temps et de la sérénité.`,
      `Design pensé pour vous → prise en main immédiate → le plaisir d’un outil qui « file juste ».`,
      `Finition nettoyée et contrôlée → moins de mauvaises surprises → la confiance d’acheter les yeux fermés.`,
    ],
    reassurance: [
      `Produit neuf, emballé avec soin — si un souci arrive, notre SAV répond rapidement.`,
      `Satisfait ou échange : on privilégie votre tranquillité d’esprit sur la catégorie ${cat}.`,
    ],
    ctas: [`Découvrir mon nouveau ${clipTitle(name, 22)}`, `Sécuriser mon offre maintenant`],
    story: `Imaginez : le colis s’ouvre, la texture sous les doigts, et ce petit déclic « c’est exactement ce qu’il me fallait ».`,
    short_pitch: `La version claire, nette et prête à l’emploi de ${name}.`,
    _fallback: true,
  };
}

async function generateNeuroCopy(inputs, { timeoutMs = 18000 } = {}) {
  const user = `Voici les données brutes du produit (déjà triées depuis EBX) :
- Nom : ${inputs.name}
- Catégorie : ${inputs.category}
- Description brute / Caractéristiques : ${inputs.description}
- Prix : ${inputs.price > 0 ? inputs.price.toFixed(2) + " €" : "n/a"}

Génère la nouvelle annonce JSON selon le format système.
Titres propositions : max 60 caractères. seo_title : max 80 caractères.
Interdiction « Acheter » / « Valider » dans les CTA.`;

  const run = async () => {
    const completion = await callNeuroLLM(
      [
        { role: "system", content: NEURO_SYSTEM },
        { role: "user", content: user },
      ],
      { temperature: 0.65, max_tokens: 1800 }
    );
    const parsed = cleanAndParseJSON(completion.choices[0].message.content || "");
    if (parsed._parse_error) throw new Error("neuro parse fail");
    const titles = Array.isArray(parsed.titles) ? parsed.titles.map((t) => clipTitle(t, 60)).filter(Boolean) : [];
    const seo = clipTitle(parsed.seo_title || titles[0] || inputs.name, 80);
    const visual = parsed.visual && typeof parsed.visual === "object" ? parsed.visual : {};
    return {
      titles: titles.length ? titles : fallbackNeuroCopy(inputs).titles,
      seo_title: seo,
      visual: {
        primary_hex: String(visual.primary_hex || "#1e3a5f").slice(0, 7),
        primary_why: String(visual.primary_why || "").slice(0, 120),
        cta_hex: String(visual.cta_hex || "#f97316").slice(0, 7),
        cta_why: String(visual.cta_why || "").slice(0, 120),
        badge: String(visual.badge || "Best-Seller").slice(0, 28),
      },
      hook: String(parsed.hook || "").slice(0, 400),
      benefits: (Array.isArray(parsed.benefits) ? parsed.benefits : []).map((b) => String(b).slice(0, 220)).filter(Boolean).slice(0, 3),
      reassurance: (Array.isArray(parsed.reassurance) ? parsed.reassurance : []).map((b) => String(b).slice(0, 180)).filter(Boolean).slice(0, 2),
      ctas: (Array.isArray(parsed.ctas) ? parsed.ctas : []).map((b) => String(b).slice(0, 60)).filter(Boolean).slice(0, 2),
      story: String(parsed.story || "").slice(0, 280),
      short_pitch: String(parsed.short_pitch || parsed.hook || "").slice(0, 160),
      _fallback: false,
    };
  };

  try {
    const result = await Promise.race([
      run(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("neuro timeout")), timeoutMs)),
    ]);
    if (!result.benefits.length || !result.hook) {
      const fb = fallbackNeuroCopy(inputs);
      return { ...fb, ...result, benefits: result.benefits.length ? result.benefits : fb.benefits, hook: result.hook || fb.hook };
    }
    return result;
  } catch (err) {
    console.warn("[EBX] neuro copy fallback:", err.message);
    return fallbackNeuroCopy(inputs);
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML eBay inline — structure neuromarketing (sans badges flottants sur la galerie).
 */
function buildNeuroHtml(copy, imageSrcs = [], opts = {}) {
  const theme = copy.visual?.primary_hex || opts.themeColor || "#1e3a5f";
  const cta = copy.visual?.cta_hex || "#f97316";
  const badge = escapeHtml(copy.visual?.badge || "Best-Seller");
  const title = escapeHtml(copy.seo_title || "Produit");
  const pitch = escapeHtml(copy.short_pitch || "");
  const hook = escapeHtml(copy.hook || "");
  const story = escapeHtml(copy.story || "");
  const imgs = (imageSrcs || []).filter(Boolean).slice(0, 8);
  const hero = imgs[0]
    ? `<img src="${escapeHtml(imgs[0])}" alt="${title}" style="width:100%;border-radius:14px;max-height:320px;object-fit:cover;" />`
    : "";
  const side = imgs
    .slice(1, 4)
    .map(
      (src) =>
        `<img src="${escapeHtml(src)}" alt="" style="width:100%;border-radius:10px;max-height:110px;object-fit:cover;" />`
    )
    .join("");

  const benefits = (copy.benefits || [])
    .map(
      (b) =>
        `<li style="margin:0 0 10px;padding:10px 12px;background:#fff;border-radius:10px;border:1px solid #eee;font-size:13px;line-height:1.55;color:#333;">✦ ${escapeHtml(
          b
        )}</li>`
    )
    .join("");
  const reass = (copy.reassurance || [])
    .map((r) => `<p style="margin:0 0 8px;font-size:13px;color:#334155;">✓ ${escapeHtml(r)}</p>`)
    .join("");
  const ctas = (copy.ctas || [])
    .map(
      (c) =>
        `<div style="display:inline-block;margin:4px 6px 0 0;background:${cta};color:#fff;font-weight:700;font-size:13px;padding:10px 16px;border-radius:999px;">${escapeHtml(
          c
        )}</div>`
    )
    .join("");

  const raw = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:100%;color:#0f172a;background:#fff;" lang="fr">
  <div style="background:linear-gradient(135deg,${theme} 0%,#0f172a 100%);border-radius:16px;padding:24px 18px;color:#fff;margin-bottom:16px;text-align:center;">
    <span style="display:inline-block;background:rgba(255,255,255,.2);padding:4px 12px;border-radius:999px;font-size:11px;margin-bottom:10px;">${badge}</span>
    <h1 style="font-size:20px;margin:0 0 8px;line-height:1.35;">${title}</h1>
    <p style="font-size:13px;opacity:.92;margin:0;">${pitch}</p>
  </div>
  ${hero ? `<div style="margin-bottom:14px;">${hero}</div>` : ""}
  ${side ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">${side}</div>` : ""}
  <div style="background:#fff7ed;border-left:4px solid ${cta};padding:12px 14px;border-radius:0 12px 12px 0;margin-bottom:16px;">
    <p style="margin:0;font-size:14px;line-height:1.65;color:#9a3412;"><strong>Le déclic</strong> — ${hook}</p>
  </div>
  <h2 style="font-size:15px;color:${theme};margin:0 0 10px;">Ce que ça change pour vous</h2>
  <ul style="list-style:none;padding:0;margin:0 0 16px;">${benefits}</ul>
  <div style="background:#f8fafc;border-radius:12px;padding:14px;margin-bottom:16px;border:1px solid #e2e8f0;">
    <h2 style="font-size:15px;color:${theme};margin:0 0 8px;">Tranquillité d’esprit</h2>
    ${reass}
  </div>
  <div style="text-align:center;margin-bottom:16px;">${ctas}</div>
  ${
    story
      ? `<p style="font-size:13px;font-style:italic;color:#475569;line-height:1.7;margin:0;padding:12px;border-top:1px dashed #e2e8f0;">${story}</p>`
      : ""
  }
</div>`;
  return sanitizeListingHtml(scrubWhySectionInHtml(raw) || raw);
}

/**
 * Overlay badge sur la 1ʳᵉ image /media/ uniquement (Playwright/Chrome).
 */
async function overlayBadgeOnFirstImage(html, { badge = "Best-Seller", primaryHex = "#1e3a5f", ctaHex = "#f97316" } = {}) {
  const srcs = extractAllImageSrcs(html).filter((s) => /^\/media\//i.test(s));
  if (!srcs.length) return { html, changed: false };
  const first = srcs[0];
  const local = resolveLocalMediaPath(first);
  if (!local || !fs.existsSync(local)) return { html, changed: false };

  ensureCacheDir();
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch (_) {
    return { html, changed: false };
  }
  const launchOptsList = chromeLaunchOpts() || [];
  if (!launchOptsList.length) return { html, changed: false };

  const abs = path.resolve(local);
  const imgBuf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase().replace(".", "") || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/png";
  const dataUrl = `data:${mime};base64,${imgBuf.toString("base64")}`;
  const label = String(badge || "Best-Seller")
    .slice(0, 28)
    .replace(/[<>&"']/g, "");
  let browser = null;
  let lastErr = "chrome introuvable";
  try {
    for (const opt of launchOptsList) {
      try {
        browser = await chromium.launch({
          ...opt,
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", ...(opt.args || [])],
        });
        break;
      } catch (e) {
        lastErr = e.message || String(e);
        browser = null;
      }
    }
    if (!browser) throw new Error(lastErr);

    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#000;">
      <div id="wrap" style="position:relative;display:inline-block;max-width:900px;">
        <img id="img" src="${dataUrl}" style="display:block;max-width:900px;max-height:900px;" />
        <div style="position:absolute;top:14px;left:14px;background:${ctaHex};color:#fff;font:700 22px/1.2 Segoe UI,Arial,sans-serif;padding:10px 16px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.35);border:2px solid #fff;">${label}</div>
        <div style="position:absolute;bottom:0;left:0;right:0;height:28%;background:linear-gradient(transparent, ${primaryHex}cc);"></div>
      </div>
      </body></html>`,
      { waitUntil: "load", timeout: 20000 }
    );
    await page.waitForFunction(
      () => {
        const img = document.getElementById("img");
        return img && img.complete && img.naturalWidth > 0;
      },
      { timeout: 15000 }
    );
    const wrap = await page.$("#wrap");
    const shot = await wrap.screenshot({ type: "png" });
    await browser.close();
    browser = null;

    const filename = `neuro-${crypto.createHash("sha1").update(shot).digest("hex").slice(0, 20)}.png`;
    const outPath = path.join(CACHE_DIR, filename);
    fs.writeFileSync(outPath, shot);
    const newSrc = publicMediaPath(filename);
    // Remplace uniquement la première occurrence de l'ancienne src
    let replaced = false;
    const nextHtml = String(html).replace(new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), (m) => {
      if (replaced) return m;
      replaced = true;
      return newSrc;
    });
    return { html: nextHtml, changed: replaced, publicPath: newSrc };
  } catch (err) {
    console.warn("[EBX] badge overlay:", err.message);
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
    return { html, changed: false };
  }
}

/**
 * Pipeline complet : triage → copy → HTML → badge 1ʳᵉ image.
 */
async function customizeListingForPublish(listing, { send = () => {}, force = false } = {}) {
  if (!listing?.id) return listing;
  // Évite de re-customiser à chaque retry dans la même session si déjà marqué
  if (!force && /data-ebx-neuro="1"/i.test(String(listing.html_description || ""))) {
    return listing;
  }

  const inputs = triageListingInputs(listing);
  send({ type: "log", message: `[NEURO] Customisation — « ${inputs.name.slice(0, 48)} » · ${inputs.category}` });

  const copy = await generateNeuroCopy(inputs);
  send({
    type: "log",
    message: `[NEURO] Titre: ${copy.seo_title.slice(0, 60)}${copy._fallback ? " (fallback local)" : " (LLM)"} · badge « ${copy.visual.badge} »`,
  });

  let html = buildNeuroHtml(copy, inputs.images.length ? inputs.images : extractAllImageSrcs(listing.html_description), {
    themeColor: copy.visual.primary_hex,
  });
  // Marqueur pour idempotence
  html = html.replace(
    /^<div /,
    '<div data-ebx-neuro="1" '
  );

  const overlay = await overlayBadgeOnFirstImage(html, {
    badge: copy.visual.badge,
    primaryHex: copy.visual.primary_hex,
    ctaHex: copy.visual.cta_hex,
  });
  if (overlay.changed) {
    html = overlay.html;
    send({ type: "log", message: `[NEURO] Badge appliqué sur la 1ʳᵉ image uniquement` });
  }

  return {
    ...listing,
    seo_title: copy.seo_title.slice(0, 80),
    html_description: html,
    _neuro: {
      titles: copy.titles,
      visual: copy.visual,
      ctas: copy.ctas,
      fallback: Boolean(copy._fallback),
    },
  };
}

module.exports = {
  triageListingInputs,
  inferCategory,
  generateNeuroCopy,
  fallbackNeuroCopy,
  buildNeuroHtml,
  overlayBadgeOnFirstImage,
  customizeListingForPublish,
  clipTitle,
};
