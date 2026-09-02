"""
LTX Video Studio — serveur web local (port 8191).
Démarre ComfyUI automatiquement si nécessaire.
"""

from __future__ import annotations

import asyncio
import copy
import json
import random
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import aiohttp
import uvicorn
import websockets
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Chemins (auto-détection depuis l'emplacement de server.py)
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
INDEX_PATH = BASE_DIR / "index.html"
LOG_DIR = BASE_DIR / "logs"

# ComfyUI : dossier frère par défaut, ou chemin fixe connu
_candidate_comfy = BASE_DIR.parent / "ComfyUI-ARM-Windows"
COMFY_DIR = _candidate_comfy if _candidate_comfy.is_dir() else Path(r"C:\ComfyUI-ARM\ComfyUI-ARM-Windows")
COMFY_PYTHON = COMFY_DIR / "venv" / "Scripts" / "python.exe"
OUTPUT_DIR = COMFY_DIR / "output"

WORKFLOW_CANDIDATES = [
    BASE_DIR / "workflow_ltx.json",
    BASE_DIR.parent / "ltxv_text_to_video_0.9.5.json",
    Path(r"C:\ComfyUI-ARM\ltxv_text_to_video_0.9.5.json"),
    COMFY_DIR / "ltxv_text_to_video_0.9.5.json",
]
COMFY_HTTP = "http://127.0.0.1:8190"
COMFY_WS = "ws://127.0.0.1:8190"

NODE_POSITIVE = "6"
NODE_NEGATIVE = "7"
NODE_LATENT = "70"
NODE_SCHEDULER = "71"
NODE_SAMPLER = "72"
NODE_SAVE = "41"

DEFAULT_NEGATIVE = "blur, watermark, low quality, distorted"

EMBEDDED_WORKFLOW: dict[str, Any] = {
    "69": {
        "class_type": "LTXVConditioning",
        "inputs": {"positive": ["6", 0], "negative": ["7", 0], "frame_rate": 25},
    },
    "71": {
        "class_type": "LTXVScheduler",
        "inputs": {
            "latent": ["70", 0],
            "steps": 20,
            "max_shift": 2.05,
            "base_shift": 0.95,
            "stretch": True,
            "terminal": 0.1,
        },
    },
    "44": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "ltx-video-2b-v0.9.5.safetensors"},
    },
    "38": {
        "class_type": "CLIPLoader",
        "inputs": {"clip_name": "t5xxl_fp16.safetensors", "type": "ltxv", "device": "default"},
    },
    "72": {
        "class_type": "SamplerCustom",
        "inputs": {
            "model": ["44", 0],
            "positive": ["69", 0],
            "negative": ["69", 1],
            "sampler": ["73", 0],
            "sigmas": ["71", 0],
            "latent_image": ["70", 0],
            "add_noise": True,
            "noise_seed": 0,
            "cfg": 4.0,
        },
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["72", 0], "vae": ["44", 2]},
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": ["38", 0], "text": DEFAULT_NEGATIVE},
    },
    "41": {
        "class_type": "SaveAnimatedWEBP",
        "inputs": {
            "images": ["8", 0],
            "filename_prefix": "LTXStudio",
            "fps": 24,
            "lossless": False,
            "quality": 95,
            "method": "default",
        },
    },
    "73": {
        "class_type": "KSamplerSelect",
        "inputs": {"sampler_name": "res_multistep"},
    },
    "70": {
        "class_type": "EmptyLTXVLatentVideo",
        "inputs": {"width": 512, "height": 320, "length": 17, "batch_size": 1},
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": ["38", 0], "text": ""},
    },
}

_comfy_process: subprocess.Popen[Any] | None = None


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=2)


app = FastAPI(title="LTX Video Studio", docs_url=None, redoc_url=None)


def log(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with (LOG_DIR / "server.log").open("a", encoding="utf-8") as handle:
        handle.write(f"{message}\n")


def read_log_tail(path: Path, lines: int = 12) -> str:
    if not path.is_file():
        return ""
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(content[-lines:])


def find_workflow_path() -> Path | None:
    for candidate in WORKFLOW_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def diagnose_comfy_error() -> str:
    tail = read_log_tail(LOG_DIR / "comfyui.log", 20)
    upper = tail.upper()
    if "CUDA" in upper or "TORCH NOT COMPILED" in upper:
        return "ComfyUI plante (erreur CUDA). Relancez avec --cpu via LTX_Studio.bat."
    if "NO MODULE" in upper or "MODULENOTFOUND" in upper:
        return "Module Python manquant dans ComfyUI. Consultez logs/comfyui.log."
    if not COMFY_PYTHON.is_file():
        return f"Python ComfyUI introuvable : {COMFY_PYTHON}"
    if not (COMFY_DIR / "main.py").is_file():
        return f"ComfyUI introuvable : {COMFY_DIR}"
    if _comfy_process and _comfy_process.poll() is not None:
        return f"ComfyUI s'est arrêté (code {_comfy_process.returncode}). Voir logs/comfyui.log."
    return "ComfyUI démarre… le premier lancement peut prendre 5 minutes."


async def comfy_is_ready() -> bool:
    timeout = aiohttp.ClientTimeout(total=4)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(f"{COMFY_HTTP}/system_stats") as response:
                if response.status != 200:
                    return False
                body = await response.json()
                return isinstance(body.get("system"), dict)
    except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError):
        return False


def start_comfyui_background() -> None:
    global _comfy_process

    if not COMFY_PYTHON.is_file():
        log(f"ERREUR: Python introuvable {COMFY_PYTHON}")
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / "comfyui.log"
    cmd = [
        str(COMFY_PYTHON),
        "main.py",
        "--cpu",
        "--force-fp16",
        "--port",
        "8190",
        "--database-url",
        "sqlite:///C:/ComfyUI-ARM/comfyui_ltx.db",
    ]
    log(f"Démarrage ComfyUI: {' '.join(cmd)}")

    with log_file.open("a", encoding="utf-8") as handle:
        _comfy_process = subprocess.Popen(
            cmd,
            cwd=str(COMFY_DIR),
            stdout=handle,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )


async def ensure_comfyui(timeout_seconds: int = 300) -> bool:
    if await comfy_is_ready():
        return True

    if _comfy_process is None or _comfy_process.poll() is not None:
        start_comfyui_background()

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if await comfy_is_ready():
            log("ComfyUI prêt.")
            return True
        if _comfy_process and _comfy_process.poll() is not None:
            log(f"ComfyUI arrêté (code {_comfy_process.returncode}), nouvel essai...")
            start_comfyui_background()
        await asyncio.sleep(3)

    log("Timeout attente ComfyUI")
    return False


def load_workflow_template() -> dict[str, Any]:
    workflow_path = find_workflow_path()
    if workflow_path:
        with workflow_path.open(encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data.get("prompt"), dict):
            return copy.deepcopy(data["prompt"])
        if isinstance(data.get("nodes"), list):
            return ui_workflow_to_api(data)
    return copy.deepcopy(EMBEDDED_WORKFLOW)


def ui_workflow_to_api(data: dict[str, Any]) -> dict[str, Any]:
    nodes_by_id = {str(node["id"]): node for node in data["nodes"]}
    link_lookup: dict[int, tuple[str, int]] = {}
    for link in data.get("links", []):
        link_id, from_node, from_slot, _to_node, _to_slot, _type = link[:6]
        link_lookup[link_id] = (str(from_node), from_slot)

    prompt: dict[str, Any] = {}
    for node_id, node in nodes_by_id.items():
        class_type = node.get("type") or node.get("class_type")
        if not class_type:
            continue

        inputs: dict[str, Any] = {}
        widget_index = 0
        widgets = node.get("widgets_values") or []

        for slot in node.get("inputs") or []:
            name = slot.get("name")
            if name is None:
                continue
            link_id = slot.get("link")
            if link_id is not None and link_id in link_lookup:
                src_node, src_slot = link_lookup[link_id]
                inputs[name] = [src_node, src_slot]
            elif widget_index < len(widgets):
                inputs[name] = widgets[widget_index]
                widget_index += 1

        prompt[node_id] = {"class_type": class_type, "inputs": inputs}

    return prompt


def build_prompt(positive: str) -> dict[str, Any]:
    workflow = load_workflow_template()
    workflow[NODE_POSITIVE]["inputs"]["text"] = positive.strip()
    workflow[NODE_NEGATIVE]["inputs"]["text"] = DEFAULT_NEGATIVE
    workflow[NODE_LATENT]["inputs"]["width"] = 512
    workflow[NODE_LATENT]["inputs"]["height"] = 320
    workflow[NODE_LATENT]["inputs"]["length"] = 17
    workflow[NODE_LATENT]["inputs"]["batch_size"] = 1
    workflow[NODE_SCHEDULER]["inputs"]["steps"] = 20
    workflow[NODE_SAMPLER]["inputs"]["cfg"] = 4.0
    workflow[NODE_SAMPLER]["inputs"]["noise_seed"] = random.randint(0, 2**53 - 1)
    workflow[NODE_SAVE]["inputs"]["filename_prefix"] = "LTXStudio"
    return workflow


async def comfy_queue(prompt: dict[str, Any], client_id: str) -> str:
    payload = {"prompt": prompt, "client_id": client_id}
    timeout = aiohttp.ClientTimeout(total=60)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{COMFY_HTTP}/prompt", json=payload) as response:
                body = await response.json(content_type=None)
                if response.status >= 400:
                    log(f"ComfyUI refuse: {body}")
                    raise HTTPException(status_code=502, detail="comfy_refused")
    except aiohttp.ClientError as exc:
        log(f"ComfyUI injoignable: {exc}")
        raise HTTPException(status_code=503, detail="comfy_offline") from exc

    prompt_id = body.get("prompt_id")
    if not prompt_id:
        raise HTTPException(status_code=502, detail="comfy_invalid_response")
    return prompt_id


async def comfy_history_filename(prompt_id: str) -> str:
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"{COMFY_HTTP}/history/{prompt_id}") as response:
            if response.status >= 400:
                raise HTTPException(status_code=502, detail="history_failed")
            history = await response.json()

    entry = history.get(prompt_id, {})
    outputs = entry.get("outputs", {})
    node_output = outputs.get(NODE_SAVE)
    if not node_output:
        raise HTTPException(status_code=502, detail="no_output")

    media = node_output.get("images") or node_output.get("gifs") or []
    if not media:
        raise HTTPException(status_code=502, detail="no_media")
    return media[0]["filename"]


@app.on_event("startup")
async def startup() -> None:
    log("LTX Studio démarré")
    asyncio.create_task(ensure_comfyui(timeout_seconds=600))


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    if not INDEX_PATH.is_file():
        raise HTTPException(status_code=500, detail="index_missing")
    return HTMLResponse(content=INDEX_PATH.read_text(encoding="utf-8"))


@app.get("/api/status")
async def status() -> JSONResponse:
    if await comfy_is_ready():
        return JSONResponse({"status": "ready"})
    return JSONResponse(
        {
            "status": "offline",
            "starting": _comfy_process is not None and _comfy_process.poll() is None,
            "hint": diagnose_comfy_error(),
        }
    )


@app.get("/api/diag")
async def diag() -> JSONResponse:
    return JSONResponse(
        {
            "comfy_ready": await comfy_is_ready(),
            "comfy_dir": str(COMFY_DIR),
            "comfy_dir_exists": COMFY_DIR.is_dir(),
            "python_exists": COMFY_PYTHON.is_file(),
            "studio_dir": str(BASE_DIR),
            "comfy_process": _comfy_process.poll() if _comfy_process else None,
            "hint": diagnose_comfy_error(),
            "comfy_log_tail": read_log_tail(LOG_DIR / "comfyui.log", 8),
        }
    )


@app.post("/api/start-comfy")
async def start_comfy() -> JSONResponse:
    ok = await ensure_comfyui(timeout_seconds=300)
    if ok:
        return JSONResponse({"status": "ready"})
    return JSONResponse({"status": "offline", "hint": diagnose_comfy_error()})


@app.post("/api/generate")
async def generate(body: GenerateRequest) -> JSONResponse:
    if not await ensure_comfyui(timeout_seconds=120):
        raise HTTPException(status_code=503, detail="comfy_offline")

    client_id = str(uuid.uuid4())
    workflow = build_prompt(body.prompt)
    prompt_id = await comfy_queue(workflow, client_id)
    return JSONResponse({"prompt_id": prompt_id, "client_id": client_id})


@app.get("/api/video/{filename}")
async def video(filename: str) -> FileResponse:
    if not filename or ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="invalid_filename")
    path = OUTPUT_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not_found")
    return FileResponse(path, media_type="image/webp", filename=filename)


@app.websocket("/ws")
async def ws_bridge(websocket: WebSocket, client_id: str, prompt_id: str) -> None:
    await websocket.accept()
    comfy_url = f"{COMFY_WS}/ws?clientId={client_id}"

    try:
        async with websockets.connect(comfy_url, open_timeout=15) as comfy_ws:
            await websocket.send_json(
                {"type": "status", "message": "Génération en cours sur CPU, patience...", "progress": 0.05}
            )

            while True:
                try:
                    raw = await asyncio.wait_for(comfy_ws.recv(), timeout=45)
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "heartbeat", "progress": None})
                    continue

                if isinstance(raw, bytes):
                    continue

                message = json.loads(raw)
                msg_type = message.get("type")
                data = message.get("data", {})

                if msg_type == "progress" and data.get("prompt_id") == prompt_id:
                    value = float(data.get("value", 0))
                    maximum = float(data.get("max", 1)) or 1.0
                    ratio = min(max(value / maximum, 0.0), 1.0)
                    await websocket.send_json(
                        {
                            "type": "progress",
                            "percent": round(ratio * 100, 1),
                            "message": f"Étape {int(value)}/{int(maximum)}",
                            "progress": 0.1 + ratio * 0.85,
                        }
                    )
                    continue

                if msg_type == "executing" and data.get("prompt_id") == prompt_id:
                    if data.get("node") is not None:
                        continue

                    filename = await comfy_history_filename(prompt_id)
                    await websocket.send_json(
                        {
                            "type": "complete",
                            "filename": filename,
                            "video_url": f"/api/video/{filename}",
                            "progress": 1.0,
                        }
                    )
                    break

                if msg_type == "execution_error" and data.get("prompt_id") == prompt_id:
                    await websocket.send_json({"type": "error", "message": "La génération a échoué."})
                    break

    except WebSocketDisconnect:
        return
    except Exception as exc:
        log(f"WebSocket erreur: {exc}")
        await websocket.send_json({"type": "error", "message": "Connexion interrompue."})


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8191, reload=False, log_level="warning")
