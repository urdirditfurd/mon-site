/**
 * Auth web multi-utilisateurs (inscription / session cookie).
 * Chaque user peut ensuite lier SON compte eBay via OAuth navigateur.
 */

const crypto = require("crypto");

const SESSION_COOKIE = "ebx_session";
const SESSION_DAYS = 30;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(String(password), salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
  } catch (_) {
    return false;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, token, { secure = false } = {}) {
  const maxAge = SESSION_DAYS * 24 * 3600;
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function publicBaseUrl(req) {
  const configured = String(process.env.EBX_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 3000}`)
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function signOAuthState(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyOAuthState(state, secret) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (_) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data || Number(data.exp) < Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function createWebAuth(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const insertUser = db.prepare(
    "INSERT INTO web_users (email, password_hash) VALUES (?, ?)"
  );
  const getUserByEmail = db.prepare("SELECT * FROM web_users WHERE email = ?");
  const getUserById = db.prepare("SELECT id, email, created_at FROM web_users WHERE id = ?");
  const insertSession = db.prepare(
    "INSERT INTO web_sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  );
  const getSession = db.prepare("SELECT * FROM web_sessions WHERE token = ?");
  const deleteSession = db.prepare("DELETE FROM web_sessions WHERE token = ?");
  const deleteExpired = db.prepare("DELETE FROM web_sessions WHERE expires_at < datetime('now')");

  function normalizeEmail(email) {
    return String(email || "")
      .trim()
      .toLowerCase();
  }

  function register(email, password) {
    const e = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      throw new Error("Email invalide");
    }
    if (String(password || "").length < 8) {
      throw new Error("Mot de passe : 8 caractères minimum");
    }
    if (getUserByEmail.get(e)) throw new Error("Cet email est déjà inscrit");
    const info = insertUser.run(e, hashPassword(password));
    return getUserById.get(info.lastInsertRowid);
  }

  function login(email, password) {
    const row = getUserByEmail.get(normalizeEmail(email));
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new Error("Email ou mot de passe incorrect");
    }
    return getUserById.get(row.id);
  }

  function createSession(userId) {
    deleteExpired.run();
    const token = randomToken(32);
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    insertSession.run(token, userId, expires);
    return token;
  }

  function userFromRequest(req) {
    deleteExpired.run();
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (!token) return null;
    const sess = getSession.get(token);
    if (!sess) return null;
    if (new Date(sess.expires_at).getTime() < Date.now()) {
      deleteSession.run(token);
      return null;
    }
    return getUserById.get(sess.user_id) || null;
  }

  function logout(req, res) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) deleteSession.run(token);
    clearSessionCookie(res);
  }

  return {
    register,
    login,
    createSession,
    userFromRequest,
    logout,
    setSessionCookie,
    clearSessionCookie,
    SESSION_COOKIE,
  };
}

module.exports = {
  createWebAuth,
  publicBaseUrl,
  signOAuthState,
  verifyOAuthState,
  randomToken,
};
