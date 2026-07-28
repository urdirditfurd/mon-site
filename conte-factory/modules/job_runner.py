"""Lance une generation en arriere-plan (UI reste responsive + barre %)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from config import ROOT
from modules.progress import clear_job, get_job, get_progress, set_job, set_progress

VOICE_MAP = {
    "femme": "femme",
    "homme": "homme",
    "auto": "auto",
}


def resolve_voice(choice: str) -> str:
    """Conserve femme/homme/auto pour le mode dialogues multi-voix."""
    key = (choice or "auto").strip().lower()
    if key in VOICE_MAP:
        return VOICE_MAP[key]
    # Legacy : id Edge-TTS passé tel quel (audio.py le mappe)
    return choice.strip() if choice else "auto"


# API Creation — si l'UI voit une erreur style_key, c'est un vieux job_runner en cache.
JOB_RUNNER_API = 3


def start_generation_job(
    *,
    theme: str,
    duration_min: float,
    voice: str = "auto",
    subtitles: bool = False,
    publish: bool = False,
    age_group: str = "1-10",
    style_key: str = "aquarelle",
    aspect: str = "16:9",
    music: str = "berceuse",
    script_path: str | None = None,
    force_new: bool = False,
    **_extra: Any,
) -> dict[str, Any]:
    """Demarre main.py en sous-processus avec les options UI.

    **_extra absorbe d'anciens/nouveaux kwargs pour eviter TypeError
    si Streamlit a un module partiellement desynchronise.
    """
    _ = _extra
    style_key = str(style_key or "aquarelle").strip() or "aquarelle"
    aspect = str(aspect or "16:9").strip() or "16:9"
    music = str(music or "berceuse").strip() or "berceuse"
    script_path = (str(script_path).strip() if script_path else "") or None

    existing = get_job()
    if existing and existing.get("running"):
        pid = existing.get("pid")
        if pid and _pid_alive(int(pid)):
            return {"ok": False, "error": "Une generation est deja en cours", "job": existing}

    set_progress(step="start", message="Preparation de la generation…")
    py = sys.executable
    cmd = [
        py,
        str(ROOT / "main.py"),
        "--duration",
        str(float(duration_min)),
        "--voice",
        resolve_voice(voice),
        "--age",
        age_group,
        "--style",
        style_key,
        "--aspect",
        aspect,
        "--music",
        music,
    ]
    if script_path:
        cmd.extend(["--script", script_path])
        if force_new:
            cmd.append("--force-new")
    else:
        cmd.extend(["--theme", theme.strip() or "conte magique"])
    if subtitles:
        cmd.append("--subtitles")
    if publish:
        cmd.append("--publish")
    else:
        cmd.append("--no-publish")

    log_path = ROOT / "data" / "job.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_f = log_path.open("a", encoding="utf-8")
    log_f.write(
        f"\n=== JOB theme={theme!r} script={script_path!r} {duration_min}min "
        f"age={age_group} style={style_key} aspect={aspect} music={music} ===\n"
    )
    log_f.flush()

    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        stdout=log_f,
        stderr=subprocess.STDOUT,
        env={
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
        },
        creationflags=creationflags,
    )
    job = {
        "ok": True,
        "running": True,
        "pid": proc.pid,
        "theme": theme,
        "script_path": script_path,
        "duration_min": duration_min,
        "voice": voice,
        "subtitles": subtitles,
        "publish": publish,
        "age_group": age_group,
        "style_key": style_key,
        "aspect": aspect,
        "music": music,
        "log": str(log_path),
        "exit_code_file": str(ROOT / "data" / "job.exit"),
    }
    # Nettoyer ancien code sortie
    try:
        Path(job["exit_code_file"]).unlink(missing_ok=True)
    except Exception:
        pass
    set_job(job)
    return job


def start_resume_job(
    *,
    video_id: int,
    only: str = "video_ai",
    publish: bool = False,
) -> dict[str, Any]:
    """Reprend un projet existant (ex: #36 audio_ok → video_ai) en arriere-plan."""
    existing = get_job()
    if existing and existing.get("running"):
        pid = existing.get("pid")
        if pid and _pid_alive(int(pid)):
            return {"ok": False, "error": "Une generation est deja en cours", "job": existing}

    step = (only or "video_ai").strip()
    set_progress(
        step=step if step in {"storyboard", "audio", "video_ai", "montage", "publish"} else "video_ai",
        message=f"Reprise projet #{video_id} ({step})…",
        video_id=int(video_id),
        detail="Scenes deja generees seront ignorees",
    )
    py = sys.executable
    cmd = [
        py,
        str(ROOT / "main.py"),
        "--resume",
        str(int(video_id)),
        "--only",
        step,
    ]
    if publish:
        cmd.append("--publish")
    else:
        cmd.append("--no-publish")

    log_path = ROOT / "data" / "job.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_f = log_path.open("a", encoding="utf-8")
    log_f.write(f"\n=== RESUME #{video_id} only={step} ===\n")
    log_f.flush()

    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        stdout=log_f,
        stderr=subprocess.STDOUT,
        env={
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
            "CONTE_I2V_PREFER_CLI": os.environ.get("CONTE_I2V_PREFER_CLI", "1"),
        },
        creationflags=creationflags,
    )
    job = {
        "ok": True,
        "running": True,
        "pid": proc.pid,
        "resume_id": int(video_id),
        "only": step,
        "publish": publish,
        "log": str(log_path),
    }
    set_job(job)
    return job


def refresh_job_status() -> dict[str, Any]:
    job = get_job() or {}
    progress = get_progress()
    pid = job.get("pid")
    alive = _pid_alive(int(pid)) if pid else False
    if job.get("running") and not alive:
        # Process fini
        if progress.get("step") not in {"done", "error"}:
            log_hint = _job_log_tail(job.get("log"), max_chars=1200)
            exit_code = _read_exit_code(job.get("exit_code_file"))
            err = "Processus termine sans statut final"
            if exit_code is not None:
                err = f"{err} (code={exit_code})"
            # Indices utiles pour reprise
            vid = progress.get("video_id")
            if vid:
                err += (
                    f"\nProjet #{vid} — pour reprendre : "
                    f"python main.py --resume {vid} --only video_ai,montage --no-publish"
                )
            if log_hint:
                # Extraire derniere ligne Traceback / Error
                for marker in ("Error", "Exception", "Traceback", "MemoryError", "CUDA"):
                    if marker in log_hint:
                        err = f"{err}\n\n{log_hint}"
                        break
                else:
                    err = f"{err}\n\n{log_hint[-600:]}"
            set_progress(
                step="error",
                message="La generation s'est arretee",
                error=err[:900],
                video_id=progress.get("video_id"),
            )
            progress = get_progress()
        job["running"] = False
        set_job(job)
    elif job and not alive:
        job["running"] = False
    return {"job": job, "progress": progress, "alive": alive}


def _read_exit_code(path: str | None) -> int | None:
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return None
    try:
        return int(p.read_text(encoding="utf-8").strip().split()[0])
    except Exception:
        return None


def _job_log_tail(log_path: str | None, max_chars: int = 800) -> str:
    if not log_path:
        log_path = str(ROOT / "data" / "job.log")
    path = Path(log_path)
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace").strip()
        if not text:
            return ""
        return text[-max_chars:]
    except Exception:
        return ""


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            return str(pid) in out
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def stop_generation_job() -> dict[str, Any]:
    job = get_job()
    if not job or not job.get("pid"):
        clear_job()
        return {"ok": True, "stopped": False}
    pid = int(job["pid"])
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
        else:
            os.kill(pid, 15)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    job["running"] = False
    set_job(job)
    set_progress(step="error", message="Generation annulee", error="Annule par l'utilisateur")
    return {"ok": True, "stopped": True}
