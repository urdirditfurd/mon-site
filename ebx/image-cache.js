/**
 * Cache local d’images produit (AliExpress / Amazon / …).
 * Objectif : ne plus dépendre des CDN externes au moment du publish EPS.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const CACHE_DIR = path.join(__dirname, "data", "images");

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function hashKey(input) {
  return crypto.createHash("sha1").update(String(input || "")).digest("hex").slice(0, 24);
}

function extFromContentType(contentType, fallbackUrl = "") {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  const m = String(fallbackUrl).match(/\.(png|jpe?g|webp|gif)(?:$|\?)/i);
  if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** Convertit WebP → PNG via Chrome (playwright-core) pour eBay EPS. */
async function convertWebpToPng(webpBuf) {
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    throw new Error("playwright-core requis pour convertir WebP → PNG");
  }
  const launchOpts = [
    { channel: "chrome" },
    { channel: "chromium" },
    { executablePath: process.env.CHROME_PATH || "" },
  ].filter((o) => o.executablePath !== "");

  // Windows chemins courants
  if (process.platform === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    launchOpts.push(
      { executablePath: `${pf}\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe` },
      { executablePath: `${pf86}\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe` },
      { executablePath: `${local}\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe` },
      { executablePath: `${pf86}\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe` }
    );
  }

  let browser = null;
  let lastErr = "chrome introuvable";
  for (const opt of launchOpts) {
    try {
      browser = await chromium.launch({
        ...opt,
        headless: true,
        args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
      });
      break;
    } catch (err) {
      lastErr = err.message;
    }
  }
  if (!browser) throw new Error(`WebP convert fail: ${lastErr}`);

  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
    const b64 = Buffer.from(webpBuf).toString("base64");
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#fff">` +
        `<img id="i" src="data:image/webp;base64,${b64}" style="max-width:1200px;max-height:1200px"/>` +
        `</body></html>`,
      { waitUntil: "load", timeout: 20000 }
    );
    await page.waitForSelector("#i", { timeout: 10000 });
    // Attend le décodage
    await page.waitForFunction(() => {
      const img = document.getElementById("i");
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 15000 });
    const loc = page.locator("#i");
    const png = await loc.screenshot({ type: "png", omitBackground: false });
    return Buffer.from(png);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Garantit un buffer compatible EPS (jpeg/png/gif). Convertit WebP si besoin.
 */
async function ensureEpsCompatibleBuffer(buf, contentType) {
  let ct = sniffImageType(buf) || contentType || "image/jpeg";
  if (!/webp/i.test(ct)) {
    return { buf, contentType: /^image\//i.test(ct) ? ct : "image/jpeg" };
  }
  console.log("[EBX] Conversion WebP → PNG (eBay EPS)…");
  const png = await convertWebpToPng(buf);
  return { buf: png, contentType: "image/png" };
}

function isMediaUrl(src) {
  const s = String(src || "");
  return /^\/media\//i.test(s) || /\/media\/[a-z0-9._-]+\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(s);
}

function mediaFilenameFromUrl(src) {
  const s = String(src || "");
  const m = s.match(/\/media\/([a-z0-9._-]+\.(?:jpg|jpeg|png|webp|gif))/i);
  return m ? m[1] : null;
}

function resolveLocalMediaPath(src) {
  const file = mediaFilenameFromUrl(src);
  if (!file) return null;
  const full = path.join(CACHE_DIR, path.basename(file));
  return fs.existsSync(full) ? full : null;
}

function publicMediaPath(filename) {
  return `/media/${filename}`;
}

/** Variantes d’URL pour contourner les thumbnails CDN bloqués. */
function candidateImageUrls(imageUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return [];
  const out = [];
  const push = (u) => {
    if (u && !out.includes(u)) out.push(u);
  };
  push(raw);

  try {
    const parsed = new URL(raw);
    parsed.search = "";
    push(parsed.toString());
  } catch (_) {}

  // AliExpress / alicdn : retire les suffixes taille _220x220.jpg
  push(raw.replace(/_\d{2,4}x\d{2,4}q?\d*\.(jpg|jpeg|png|webp)/gi, ".$1"));
  push(raw.replace(/\.\d{2,4}x\d{2,4}q?\d*\.(jpg|jpeg|png|webp)/gi, ".$1"));
  push(raw.replace(/_\d{2,4}x\d{2,4}[^/.]*\.(jpg|jpeg|png|webp)/gi, ".$1"));
  push(raw.replace(/_\d{2,4}x\d{2,4}/gi, ""));
  // Parfois double extension .jpg_50x50.jpg
  push(raw.replace(/\.(jpg|jpeg|png|webp)_\d+x\d+\.\1$/gi, ".$1"));

  // Amazon : image pleine plutôt que vignette
  push(raw.replace(/\._[A-Z]{2}[^.]{0,40}_\./g, "."));
  push(raw.replace(/\._AC_[^.]*_\./gi, "."));
  push(raw.replace(/\._SX\d+_\./gi, "."));
  push(raw.replace(/\._SY\d+_\./gi, "."));
  push(raw.replace(/\._UL\d+_\./gi, "."));
  push(raw.replace(/\._SL\d+_\./gi, "."));

  if (/\.webp(?:\?|$)/i.test(raw)) {
    push(raw.replace(/\.webp/gi, ".jpg"));
    push(raw.replace(/\.webp/gi, ".png"));
  }

  // Miroirs alicdn
  if (/ae0\d\.alicdn\.com/i.test(raw)) {
    for (const host of ["ae01.alicdn.com", "ae02.alicdn.com", "ae03.alicdn.com", "ae04.alicdn.com"]) {
      push(raw.replace(/ae0\d\.alicdn\.com/i, host));
    }
  }

  return out.slice(0, 12);
}

function referersFor(imageUrl) {
  const u = String(imageUrl || "").toLowerCase();
  if (/alicdn|aliexpress|aliexpress-media/i.test(u)) {
    return [
      "https://www.aliexpress.com/",
      "https://fr.aliexpress.com/",
      "https://www.aliexpress.us/",
      "https://login.aliexpress.com/",
    ];
  }
  if (/amazon|media-amazon|ssl-images-amazon/i.test(u)) {
    return ["https://www.amazon.fr/", "https://www.amazon.com/", "https://www.google.com/"];
  }
  if (/cdiscount|cdscdn|octopia/i.test(u)) return ["https://www.cdiscount.com/"];
  if (/ebayimg|ebaystatic/i.test(u)) return ["https://www.ebay.fr/"];
  try {
    return [new URL(imageUrl).origin + "/", "https://www.google.com/"];
  } catch {
    return ["https://www.google.com/"];
  }
}

function httpsGetBuffer(imageUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(imageUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
          Connection: "close",
          ...headers,
        },
        timeout: 25000,
      },
      (res) => {
        // redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, imageUrl).toString();
          res.resume();
          httpsGetBuffer(next, headers).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            buf: Buffer.concat(chunks),
            contentType: String(res.headers["content-type"] || "").split(";")[0].trim(),
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function fetchImageOnce(imageUrl, referer) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    // Pas de webp/avif en premier : eBay EPS n'accepte que JPEG/PNG/GIF
    Accept: "image/jpeg,image/png,image/gif,image/*,*/*;q=0.8",
    Referer: referer,
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  };

  // 1) fetch
  try {
    const res = await fetch(imageUrl, { headers, redirect: "follow" });
    if (res.ok) {
      const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, contentType, status: res.status };
    }
  } catch (_) {}

  // 2) https natif
  const native = await httpsGetBuffer(imageUrl, {
    Referer: referer,
    Accept: "image/jpeg,image/png,image/gif,image/*,*/*;q=0.8",
  });
  return { buf: native.buf, contentType: native.contentType, status: native.status };
}

function validateImageBuffer(buf, contentType) {
  if (!buf || buf.length < 500) throw new Error("image trop petite");
  if (buf.length > 12 * 1024 * 1024) throw new Error("image trop lourde (>12MB)");
  const sniffed = sniffImageType(buf);
  const ct = sniffed || contentType || "image/jpeg";
  if (!sniffed && contentType && !/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
    throw new Error(`pas une image (${contentType})`);
  }
  return sniffed || (/^image\//i.test(ct) ? ct : "image/jpeg");
}

/**
 * Télécharge une image distante (multi-essais) et la stocke dans data/images.
 * Retourne { filename, publicPath, localPath, contentType, buf }.
 */
async function cacheRemoteImage(imageUrl) {
  ensureCacheDir();
  const src = String(imageUrl || "").trim();
  if (!src) throw new Error("URL image vide");

  // Déjà local
  if (isMediaUrl(src)) {
    const localPath = resolveLocalMediaPath(src);
    if (!localPath) throw new Error(`media manquant: ${src}`);
    const buf = fs.readFileSync(localPath);
    const contentType = sniffImageType(buf) || "image/jpeg";
    return {
      filename: path.basename(localPath),
      publicPath: publicMediaPath(path.basename(localPath)),
      localPath,
      contentType,
      buf,
      fromCache: true,
    };
  }

  // eBay EPS déjà OK — on peut aussi cacher pour stabilité
  const candidates = candidateImageUrls(src);
  const referers = referersFor(src);
  let lastErr = "download fail";

  for (const candidate of candidates) {
    for (const referer of referers) {
      try {
        const { buf, contentType, status } = await fetchImageOnce(candidate, referer);
        if (!(status >= 200 && status < 300)) {
          lastErr = `HTTP ${status}`;
          continue;
        }
        const ct0 = validateImageBuffer(buf, contentType);
        const compatible = await ensureEpsCompatibleBuffer(buf, ct0);
        const ct = compatible.contentType;
        const finalBuf = compatible.buf;
        const ext = extFromContentType(ct, candidate);
        const filename = `${hashKey(src)}.${ext}`;
        const localPath = path.join(CACHE_DIR, filename);
        if (!fs.existsSync(localPath)) fs.writeFileSync(localPath, finalBuf);
        // Si on a aussi un vieux .webp du même hash, on privilégie le png
        return {
          filename,
          publicPath: publicMediaPath(filename),
          localPath,
          contentType: ct,
          buf: finalBuf,
          fromCache: false,
          sourceUrl: candidate,
        };
      } catch (err) {
        lastErr = err.message || String(err);
      }
    }
  }

  throw new Error(`cache image fail: ${lastErr}`);
}

/**
 * Charge un buffer image depuis /media/… ou URL distante (avec cache).
 */
async function loadImageBuffer(imageUrl) {
  const src = String(imageUrl || "").trim();
  if (!src) throw new Error("URL image vide");

  const localPath = resolveLocalMediaPath(src);
  if (localPath) {
    let buf = fs.readFileSync(localPath);
    let contentType = validateImageBuffer(buf, sniffImageType(buf) || "image/jpeg");
    if (/webp/i.test(contentType)) {
      const converted = await ensureEpsCompatibleBuffer(buf, contentType);
      buf = converted.buf;
      contentType = converted.contentType;
      const pngName = path.basename(localPath).replace(/\.webp$/i, ".png");
      const pngPath = path.join(CACHE_DIR, pngName);
      if (!fs.existsSync(pngPath)) fs.writeFileSync(pngPath, buf);
      return { buf, contentType, localPath: pngPath, publicPath: publicMediaPath(pngName) };
    }
    return { buf, contentType, localPath, publicPath: publicMediaPath(path.basename(localPath)) };
  }

  // Fichier absolu local (rare)
  if (/^[A-Za-z]:\\/.test(src) || src.startsWith("/workspace") || src.startsWith(__dirname)) {
    if (fs.existsSync(src)) {
      let buf = fs.readFileSync(src);
      let contentType = validateImageBuffer(buf, sniffImageType(buf) || "image/jpeg");
      if (/webp/i.test(contentType)) {
        const converted = await ensureEpsCompatibleBuffer(buf, contentType);
        buf = converted.buf;
        contentType = converted.contentType;
      }
      return { buf, contentType, localPath: src };
    }
  }

  const cached = await cacheRemoteImage(src);
  return {
    buf: cached.buf,
    contentType: cached.contentType,
    localPath: cached.localPath,
    publicPath: cached.publicPath,
  };
}

/**
 * Remplace les <img src="https://cdn…"> du HTML par /media/xxx.jpg (cache disque).
 */
async function localizeHtmlImages(html, { onProgress } = {}) {
  const raw = String(html || "");
  if (!raw) return { html: raw, cached: 0, failed: 0, map: {} };

  const re = /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi;
  const found = [];
  let m;
  while ((m = re.exec(raw))) {
    const src = m[2];
    if (!found.includes(src)) found.push(src);
  }

  const map = {};
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < found.length; i++) {
    const src = found[i];
    if (/picsum\.photos|placeholder\.com|via\.placeholder|placehold\.it|lorempixel/i.test(src)) {
      continue;
    }
    // Déjà media local
    if (isMediaUrl(src) && resolveLocalMediaPath(src)) {
      map[src] = src.startsWith("/media/") ? src : publicMediaPath(mediaFilenameFromUrl(src));
      cached += 1;
      continue;
    }
    // eBay EPS : pas besoin de recacher pour l’affichage, mais utile hors-ligne
    if (/^https?:\/\//i.test(src)) {
      try {
        const hit = await cacheRemoteImage(src);
        map[src] = hit.publicPath;
        cached += 1;
        if (typeof onProgress === "function") onProgress({ index: i + 1, total: found.length, src, ok: true });
      } catch (err) {
        failed += 1;
        console.warn(`[EBX] cache image skip: ${err.message} | ${src.slice(0, 90)}`);
        if (typeof onProgress === "function") onProgress({ index: i + 1, total: found.length, src, ok: false });
      }
    }
  }

  let out = raw;
  for (const [from, to] of Object.entries(map)) {
    if (from === to) continue;
    out = out.split(from).join(to);
  }
  return { html: out, cached, failed, map };
}

function extractAllImageSrcs(html) {
  const urls = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const src = m[1];
    if (!src) continue;
    if (/picsum\.photos|placeholder\.com|via\.placeholder|placehold\.it|lorempixel/i.test(src)) continue;
    if (!/^https?:\/\//i.test(src) && !isMediaUrl(src)) continue;
    if (!urls.includes(src)) urls.push(src);
  }
  return urls;
}

module.exports = {
  CACHE_DIR,
  ensureCacheDir,
  cacheRemoteImage,
  loadImageBuffer,
  localizeHtmlImages,
  extractAllImageSrcs,
  resolveLocalMediaPath,
  isMediaUrl,
  publicMediaPath,
  candidateImageUrls,
  ensureEpsCompatibleBuffer,
};
