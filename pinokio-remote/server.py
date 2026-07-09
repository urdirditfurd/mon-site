"""
Pinokio Remote – proxy sécurisé pour accéder à distance à tous les modèles
IA de Pinokio depuis n'importe quel appareil.

Architecture :
  • FastAPI + proxy ASGI (HTTP + WebSocket) par service
  • Auth JWT stockée en cookie httpOnly
  • Cloudflare Tunnel (cloudflared) pour l'accès internet sans port-forwarding
"""
from __future__ import annotations

import asyncio
import json
import logging
import platform
import re
import secrets
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx
import jwt
import uvicorn
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from jwt import PyJWTError

# Compatibilité websockets 10-12 (legacy) et 13+ (asyncio)
try:
    from websockets.asyncio.client import connect as ws_connect
except ImportError:
    from websockets.legacy.client import connect as ws_connect  # type: ignore[no-redef]

# ──────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pinokio-remote")

# ──────────────────────────────────────────────────────────────────
# Chemins & constantes
# ──────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"
STATIC_DIR  = BASE_DIR / "static"
IS_WIN      = platform.system() == "Windows"
CLOUDFLARED = BASE_DIR / ("cloudflared.exe" if IS_WIN else "cloudflared")

# ──────────────────────────────────────────────────────────────────
# Configuration par défaut
# ──────────────────────────────────────────────────────────────────
_DEFAULT_CFG: dict = {
    "password": "pinokio2026",
    "secret_key": secrets.token_hex(32),
    "tunnel_mode": "quick",   # "quick" = URL temporaire | "named" = URL fixe (token requis)
    "tunnel_token": "",        # token Cloudflare Named Tunnel (optionnel)
    "services": [
        {
            "name": "ComfyUI",
            "port": 8188,
            "path": "comfyui",
            "description": "Images & Vidéos – Wan2.1, AnimateDiff, FLUX…",
            "icon": "🎨",
        },
        {
            "name": "Wan 2.1",
            "port": 7862,
            "path": "wan2",
            "description": "Text-to-Video Wan2.1 (interface dédiée)",
            "icon": "🎬",
        },
        {
            "name": "Stable Diffusion",
            "port": 7860,
            "path": "sd",
            "description": "Automatic1111 / Forge WebUI",
            "icon": "🖼️",
        },
        {
            "name": "LLM Chat",
            "port": 7861,
            "path": "llm",
            "description": "Oobabooga Text Generation WebUI",
            "icon": "💬",
        },
        {
            "name": "InvokeAI",
            "port": 9090,
            "path": "invoke",
            "description": "InvokeAI – génération créative",
            "icon": "✨",
        },
        {
            "name": "Fooocus",
            "port": 7865,
            "path": "fooocus",
            "description": "Fooocus – images simplifiées",
            "icon": "🌸",
        },
        {
            "name": "Open WebUI",
            "port": 3000,
            "path": "openwebui",
            "description": "Open WebUI – interface LLM universelle",
            "icon": "🤖",
        },
    ],
}

STATIC_DIR.mkdir(exist_ok=True)
if not CONFIG_PATH.exists():
    CONFIG_PATH.write_text(
        json.dumps(_DEFAULT_CFG, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    log.info("Fichier config.json créé avec les valeurs par défaut.")

_cfg: dict    = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
SECRET_KEY: str = _cfg.get("secret_key") or secrets.token_hex(32)
PASSWORD:   str = _cfg.get("password", "pinokio2026")
SERVICES:  list = _cfg.get("services", _DEFAULT_CFG["services"])

# ──────────────────────────────────────────────────────────────────
# Auth JWT
# ──────────────────────────────────────────────────────────────────

def _make_token() -> str:
    payload = {
        "exp": datetime.utcnow() + timedelta(days=7),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def _verify_token(token: Optional[str]) -> bool:
    if not token:
        return False
    try:
        jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return True
    except PyJWTError:
        return False


def _get_token(request: Request) -> Optional[str]:
    tok = request.cookies.get("auth_token")
    if not tok:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            tok = auth[7:]
    return tok


def authed(request: Request) -> bool:
    return _verify_token(_get_token(request))

# ──────────────────────────────────────────────────────────────────
# Réécriture HTML + injection intercepteur JS
# ──────────────────────────────────────────────────────────────────

# Intercepteur injecté dans chaque page HTML proxifiée.
# Redirige fetch, XHR et WebSocket vers le bon préfixe proxy.
_INTERCEPTOR_TPL = """\
<script id="__pinokio_proxy_interceptor__">
(function(P){
  /* WebSocket → wss://host/proxy/<svc>/... */
  var _WS = window.WebSocket;
  function PatchWS(url, proto) {
    try {
      var u = new URL(url, location.href);
      var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url = scheme + '//' + location.host + P + u.pathname + (u.search || '');
    } catch(e) {}
    return proto !== undefined ? new _WS(url, proto) : new _WS(url);
  }
  PatchWS.CONNECTING = 0; PatchWS.OPEN = 1; PatchWS.CLOSING = 2; PatchWS.CLOSED = 3;
  PatchWS.prototype = _WS.prototype;
  window.WebSocket = PatchWS;

  /* fetch → /proxy/<svc>/... */
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string' && input.charAt(0) === '/' && input.indexOf(P) !== 0 && input.charAt(1) !== '/') {
      input = P + input;
    }
    return _fetch.call(this, input, init);
  };

  /* XMLHttpRequest → /proxy/<svc>/... */
  var _xopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && url.charAt(0) === '/' && url.indexOf(P) !== 0 && url.charAt(1) !== '/') {
      url = P + url;
    }
    return _xopen.apply(this, arguments);
  };
})("__PREFIX__");
</script>
"""

# Attributs HTML qui contiennent des URL
_ATTR_RE = re.compile(
    r'((?:href|src|action|poster|data-src|data-href|data-url)\s*=\s*")(/(?!/|#))',
    re.IGNORECASE,
)
_ATTR_RE_SQ = re.compile(
    r"((?:href|src|action|poster|data-src|data-href|data-url)\s*=\s*')(/(?!/|#))",
    re.IGNORECASE,
)


def rewrite_html(html: str, prefix: str) -> str:
    """Réécrit les chemins absolus et injecte l'intercepteur JS."""
    html = _ATTR_RE.sub(   lambda m: m.group(1) + prefix + "/", html)
    html = _ATTR_RE_SQ.sub(lambda m: m.group(1) + prefix + "/", html)

    snippet = _INTERCEPTOR_TPL.replace("__PREFIX__", prefix)

    head_match = re.search(r"<head\b[^>]*>", html, re.IGNORECASE)
    body_match = re.search(r"<body\b[^>]*>", html, re.IGNORECASE)

    if head_match:
        pos = head_match.end()
        html = html[:pos] + snippet + html[pos:]
    elif body_match:
        pos = body_match.end()
        html = html[:pos] + snippet + html[pos:]
    else:
        html = snippet + html

    return html

# ──────────────────────────────────────────────────────────────────
# Proxy ASGI par service (HTTP + WebSocket)
# ──────────────────────────────────────────────────────────────────

class ServiceProxy:
    """
    Application ASGI montée sur /proxy/<svc>.
    Proxifie HTTP (avec réécriture HTML) et WebSocket vers le service
    Pinokio local correspondant.
    """

    def __init__(self, svc: dict) -> None:
        self.svc          = svc
        self.port         = svc["port"]
        self.mount_prefix = f"/proxy/{svc['path']}"

    async def __call__(self, scope, receive, send) -> None:
        t = scope.get("type")
        if t == "http":
            await self._handle_http(scope, receive, send)
        elif t == "websocket":
            await self._handle_ws(scope, receive, send)

    # ── HTTP ──────────────────────────────────────────────────────

    async def _handle_http(self, scope, receive, send) -> None:
        from starlette.requests import Request as StarletteRequest

        req = StarletteRequest(scope, receive)

        if not authed(req):
            await self._redirect(scope, receive, send, "/login")
            return

        path = scope.get("path") or "/"
        if not path:
            path = "/"
        qs     = (scope.get("query_string") or b"").decode()
        target = f"http://127.0.0.1:{self.port}{path}"
        if qs:
            target += "?" + qs

        body = await req.body()
        headers = {
            k.decode(): v.decode()
            for k, v in scope.get("headers", [])
            if k.lower() not in {
                b"host", b"content-length", b"transfer-encoding",
                b"connection", b"upgrade",
            }
        }
        headers["host"] = f"127.0.0.1:{self.port}"

        try:
            async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as cli:
                async with cli.stream(
                    req.method, target,
                    content=body, headers=headers,
                ) as r:
                    ct = r.headers.get("content-type", "")
                    resp_headers = self._filter_response_headers(r.headers)

                    if "text/html" in ct:
                        raw = await r.aread()
                        html_out = rewrite_html(
                            raw.decode("utf-8", errors="replace"),
                            self.mount_prefix,
                        )
                        body_out = html_out.encode("utf-8", errors="replace")
                        resp_headers["content-type"]   = "text/html; charset=utf-8"
                        resp_headers["content-length"] = str(len(body_out))
                        await self._send_full(send, r.status_code, resp_headers, body_out)
                    else:
                        # Streaming (vidéos, images, SSE, JSON…)
                        raw_hdrs = [
                            (k.lower().encode(), v.encode())
                            for k, v in resp_headers.items()
                        ]
                        await send({
                            "type": "http.response.start",
                            "status": r.status_code,
                            "headers": raw_hdrs,
                        })
                        async for chunk in r.aiter_bytes(65536):
                            await send({
                                "type": "http.response.body",
                                "body": chunk,
                                "more_body": True,
                            })
                        await send({"type": "http.response.body", "body": b"", "more_body": False})

        except httpx.ConnectError:
            msg = (
                f"<html><body style='font:16px sans-serif;background:#0f0f1a;"
                f"color:#e0e0e0;padding:3rem;text-align:center'>"
                f"<h2>⚠️ Service non disponible</h2>"
                f"<p>Le service <strong>{self.svc['name']}</strong> "
                f"(port {self.port}) n'est pas démarré dans Pinokio.</p>"
                f"<p style='color:#888;margin-top:1rem'>"
                f"Lancez-le sur la tour, puis rechargez cette page.</p>"
                f"<button onclick='location.reload()' style='margin-top:1.5rem;"
                f"padding:.6rem 1.5rem;background:#6c63ff;color:#fff;border:none;"
                f"border-radius:6px;cursor:pointer;font-size:1rem'>"
                f"↻ Réessayer</button></body></html>"
            ).encode()
            await self._send_full(send, 503, {"content-type": "text/html; charset=utf-8"}, msg)

        except Exception:
            log.exception(f"Erreur proxy HTTP [{self.svc['name']}]")
            msg = b"502 Bad Gateway"
            await self._send_full(send, 502, {"content-type": "text/plain"}, msg)

    @staticmethod
    def _filter_response_headers(headers) -> dict:
        skip = {
            "content-encoding", "transfer-encoding",
            "content-length", "connection",
        }
        return {k: v for k, v in headers.items() if k.lower() not in skip}

    @staticmethod
    async def _send_full(send, status: int, headers: dict, body: bytes) -> None:
        raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
        if not any(k == b"content-length" for k, _ in raw):
            raw.append((b"content-length", str(len(body)).encode()))
        await send({"type": "http.response.start", "status": status, "headers": raw})
        await send({"type": "http.response.body", "body": body, "more_body": False})

    @staticmethod
    async def _redirect(scope, receive, send, location: str) -> None:
        await send({
            "type": "http.response.start",
            "status": 302,
            "headers": [(b"location", location.encode())],
        })
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    # ── WebSocket ─────────────────────────────────────────────────

    async def _handle_ws(self, scope, receive, send) -> None:
        path = scope.get("path") or "/"
        qs   = (scope.get("query_string") or b"").decode()
        url  = f"ws://127.0.0.1:{self.port}{path}"
        if qs:
            url += "?" + qs

        await send({"type": "websocket.accept", "subprotocol": None})

        try:
            async with ws_connect(url) as backend:

                async def client_to_backend() -> None:
                    while True:
                        msg = await receive()
                        if msg["type"] == "websocket.disconnect":
                            break
                        if msg.get("bytes"):
                            await backend.send(msg["bytes"])
                        elif msg.get("text"):
                            await backend.send(msg["text"])

                async def backend_to_client() -> None:
                    # Utilise recv() en boucle (compatible websockets 10-16+)
                    while True:
                        try:
                            data = await backend.recv()
                        except Exception:
                            break
                        if isinstance(data, bytes):
                            await send({"type": "websocket.send", "bytes": data, "text": None})
                        else:
                            await send({"type": "websocket.send", "text": data, "bytes": None})

                tasks = [
                    asyncio.create_task(client_to_backend()),
                    asyncio.create_task(backend_to_client()),
                ]
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for t in pending:
                    t.cancel()
                    try:
                        await t
                    except asyncio.CancelledError:
                        pass

        except Exception as e:
            log.debug(f"WS proxy [{self.svc['name']}] fermé : {e}")
        finally:
            try:
                await send({"type": "websocket.close", "code": 1000})
            except Exception:
                pass

# ──────────────────────────────────────────────────────────────────
# Gestion du tunnel Cloudflare
# ──────────────────────────────────────────────────────────────────

_tunnel_proc: Optional[subprocess.Popen] = None
_tunnel_url:  Optional[str] = None


def _start_tunnel() -> None:
    global _tunnel_proc, _tunnel_url

    if not CLOUDFLARED.exists():
        log.warning(
            "cloudflared introuvable – tunnel désactivé.\n"
            "Lancez install.bat pour le télécharger automatiquement."
        )
        return

    mode  = _cfg.get("tunnel_mode", "quick")
    token = _cfg.get("tunnel_token", "")

    if mode == "named" and token:
        cmd = [str(CLOUDFLARED), "tunnel", "--no-autoupdate", "run", "--token", token]
        log.info("Démarrage du tunnel Cloudflare (mode named)…")
    else:
        cmd = [str(CLOUDFLARED), "tunnel", "--no-autoupdate", "--url", "http://localhost:8000"]
        log.info("Démarrage du tunnel Cloudflare (mode quick, URL temporaire)…")

    _tunnel_proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    def _watch_output() -> None:
        global _tunnel_url
        if not _tunnel_proc or not _tunnel_proc.stdout:
            return
        for line in _tunnel_proc.stdout:
            line = line.strip()
            if line:
                log.debug(f"[cloudflared] {line}")
            m = re.search(
                r"https://\S+\.(?:trycloudflare\.com|cfargotunnel\.com)",
                line,
            )
            if m:
                _tunnel_url = m.group(0)
                print(f"\n{'='*55}", flush=True)
                print(f"  🌐  URL PUBLIQUE : {_tunnel_url}", flush=True)
                print(f"{'='*55}\n", flush=True)

    threading.Thread(target=_watch_output, daemon=True, name="cf-watcher").start()


def _stop_tunnel() -> None:
    if _tunnel_proc:
        try:
            _tunnel_proc.terminate()
            _tunnel_proc.wait(timeout=5)
        except Exception:
            pass

# ──────────────────────────────────────────────────────────────────
# Application FastAPI
# ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def _lifespan(application: FastAPI):
    _start_tunnel()
    yield
    _stop_tunnel()


app = FastAPI(title="Pinokio Remote", lifespan=_lifespan)

# Monte les proxies de service AVANT les routes statiques
for _svc in SERVICES:
    _proxy = ServiceProxy(_svc)
    app.mount(f"/proxy/{_svc['path']}", _proxy)

# Fichiers statiques (JS, CSS…)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ── Authentification ──────────────────────────────────────────────

@app.get("/login", response_class=HTMLResponse)
async def login_page() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "login.html").read_text("utf-8"))


@app.post("/auth/login")
async def do_login(password: str = Form(...)) -> JSONResponse:
    if password != PASSWORD:
        raise HTTPException(status_code=401, detail="Mot de passe incorrect")
    token = _make_token()
    resp  = JSONResponse({"ok": True})
    resp.set_cookie(
        "auth_token",
        token,
        httponly=True,
        samesite="lax",
        max_age=7 * 24 * 3600,
    )
    return resp


@app.post("/auth/logout")
async def do_logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("auth_token")
    return resp

# ── API ───────────────────────────────────────────────────────────

@app.get("/api/services")
async def api_services(request: Request) -> list:
    if not authed(request):
        raise HTTPException(status_code=401)
    result = []
    for svc in SERVICES:
        running = False
        try:
            async with httpx.AsyncClient(timeout=1.5) as cli:
                r = await cli.get(f"http://127.0.0.1:{svc['port']}/")
                running = r.status_code < 500
        except Exception:
            running = False
        result.append({**svc, "status": "running" if running else "stopped"})
    return result


@app.get("/api/tunnel")
async def api_tunnel(request: Request) -> dict:
    if not authed(request):
        raise HTTPException(status_code=401)
    return {"url": _tunnel_url, "active": _tunnel_url is not None}


@app.get("/api/health")
async def api_health() -> dict:
    return {"ok": True, "ts": int(time.time())}

# ── Dashboard principal ───────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request) -> HTMLResponse:
    if not authed(request):
        return RedirectResponse("/login")  # type: ignore[return-value]
    return HTMLResponse((STATIC_DIR / "index.html").read_text("utf-8"))


# ── Point d'entrée ────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 55)
    print("  ⚡  Pinokio Remote — démarrage")
    print(f"  Local : http://localhost:8000")
    print("=" * 55 + "\n")
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False, log_level="info")
