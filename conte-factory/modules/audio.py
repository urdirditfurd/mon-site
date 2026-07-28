"""Étape 3 — Dialogues multi-voix (personnages) + durée réelle cible.

Pas de narrateur VO unique : chaque réplique = voix du personnage.
Edge-TTS jeunesse haute qualité + pauses naturelles + export 44.1 kHz.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from config import TARGET_DURATION_MIN, TTS_PITCH, TTS_RATE, TTS_VOICE
from db.database import get_video, log_event, project_dir, resolve_project_dir, update_video
from modules.creative_options import voices_for_preference
from modules.youth_spec import normalize_age, youth_profile

# Export audio haute qualite (pas de compression agressive)
TTS_SAMPLE_RATE = int(os.getenv("CONTE_TTS_SAMPLE_RATE", "44100"))
TTS_MP3_BITRATE = os.getenv("CONTE_TTS_MP3_BITRATE", "192k")


def _ffprobe_duration(path: Path) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    return float(out)


_PARASITIC_PATTERNS = [
    re.compile(r"(?i)^bonjour\b[^.!?]*[.!?…]?\s*"),
    re.compile(r"(?i)^salut\b[^.!?]*[.!?…]?\s*"),
    re.compile(r"(?i)^coucou\b[^.!?]*[.!?…]?\s*"),
    re.compile(r"(?i)^(aujourd['''\s]?hui?|ce soir),?\s*(nous allons|on va|je vais)\b[^.!?]*[.!?…]?\s*"),
    re.compile(r"(?i)^bienvenue\b[^.!?]*[.!?…]?\s*"),
    re.compile(r"(?i)^chers?\s+(enfants?|amis?|petits?)\b[^.!?]*[.!?…]?\s*"),
    re.compile(r"(?i)^(hello|hi|hey)\b[^.!?]*[.!?…]?\s*"),
    re.compile(r"(?i)^(voici|c[''']est)\s+(l[''']histoire|le conte|une histoire)\b[^.!?]*[.!?…]?\s*"),
    re.compile(r"(?i)^je (te|vous) (confie|raconte|lis)\b[^.!?]*[.!?…]?\s*"),
]
_METADATA_PATTERNS = [
    re.compile(r"(?i),?\s*\bsc[eèé]ne\s+\d+\b,?\s*"),
    re.compile(r"(?i),?\s*\bnum[eéè]ro\s+\d+\b,?\s*"),
    re.compile(r"(?i),?\s*\bacte\s+\d+\b,?\s*"),
    re.compile(r"(?i),?\s*\bpartie\s+\d+\b,?\s*"),
]


def _strip_parasitic_text(text: str) -> str:
    """Supprime formules d'introduction, salutations et métadonnées scène."""
    t = text.strip()
    for pat in _PARASITIC_PATTERNS:
        t = pat.sub("", t).strip()
    for pat in _METADATA_PATTERNS:
        t = pat.sub(" ", t).strip()
    t = re.sub(r"^[,;:\s]+", "", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    if t and t[0].islower():
        t = t[0].upper() + t[1:]
    return t if t else text.strip()


def _prosody_text(text: str) -> str:
    """Insere virgules / points / pauses pour une diction conteuse naturelle."""
    t = _strip_parasitic_text(" ".join((text or "").split()))
    if not t:
        return "..."
    # Normaliser espaces avant ponctuation
    t = re.sub(r"\s+([,;:!?…])", r"\1", t)
    # Apres .!? — pause explicite Edge-TTS ("...")
    t = re.sub(r"([.!?…])\s+", r"\1 ... ", t)
    # Apres virgule — micro-pause legere (pas trop dense)
    t = re.sub(r",\s*", ", ", t)
    if t.count(",") >= 1 and "..." not in t:
        # Une seule micro-pause apres la 1ere virgule
        t = t.replace(", ", ", ... ", 1)
    # Eviter doubles pauses
    t = re.sub(r"(\.\.\.\s*){2,}", "... ", t)
    # Si phrase longue sans ponctuation, couper aux conjonctions
    if "," not in t and "." not in t and len(t) > 90:
        t = re.sub(
            r"\b(et|mais|puis|alors|quand|parce que|car)\b",
            r", ... \1",
            t,
            count=2,
            flags=re.IGNORECASE,
        )
    # Garantir ponctuation finale
    if t[-1] not in ".!?…":
        t = t + "."
    return t.strip()


# Compat anciens appels
def _soften_text(text: str) -> str:
    return _prosody_text(text)


def _normalize_tts_rate(rate: str | None) -> str:
    """Edge-TTS exige un signe : +0% / -12% (jamais '0%' seul)."""
    raw = (rate or TTS_RATE or "-12%").strip()
    m = re.fullmatch(r"([+-]?)(\d+)\s*%", raw)
    if not m:
        return "-12%"
    sign, num = m.group(1), m.group(2)
    if not sign:
        sign = "+" if num == "0" else "-"
    return f"{sign}{num}%"


def _normalize_tts_pitch(pitch: str | None) -> str:
    """Edge-TTS exige un signe : +0Hz / -1Hz (jamais '0Hz' → Invalid pitch)."""
    raw = (pitch or TTS_PITCH or "+0Hz").strip()
    m = re.fullmatch(r"([+-]?)(\d+)\s*[Hh][Zz]", raw)
    if not m:
        return "+0Hz"
    sign, num = m.group(1), m.group(2)
    if not sign:
        sign = "+"
    return f"{sign}{num}Hz"


def _reencode_hq(src: Path, dest: Path) -> None:
    """Re-encode en 44.1 kHz (ou 24 kHz) MP3 192k — lisible et net."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    rate = TTS_SAMPLE_RATE if TTS_SAMPLE_RATE in {24000, 44100, 48000} else 44100
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-ar",
        str(rate),
        "-ac",
        "1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        TTS_MP3_BITRATE,
        "-q:a",
        "2",
        str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


async def _synthesize(text: str, out_path: Path, voice: str, rate: str, pitch: str) -> None:
    import edge_tts

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        communicate = edge_tts.Communicate(
            text=_prosody_text(text),
            voice=voice,
            rate=_normalize_tts_rate(rate),
            pitch=_normalize_tts_pitch(pitch),
        )
        await communicate.save(str(tmp_path))
        _reencode_hq(tmp_path, out_path)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _voice_preference_from_voice(voice: str | None) -> str:
    v = (voice or "").lower()
    if "remy" in v or "henri" in v or "homme" in v:
        return "homme"
    if "vivienne" in v or "denise" in v or "femme" in v or "eloise" in v:
        return "femme"
    return "auto"


def _dialogue_for_scene(scene: dict[str, Any]) -> list[dict[str, str]]:
    raw = scene.get("dialogue")
    if isinstance(raw, list) and raw:
        out = []
        for line in raw:
            if isinstance(line, dict) and str(line.get("text") or "").strip():
                out.append(
                    {
                        "speaker": str(line.get("speaker") or "heros"),
                        "text": str(line["text"]).strip(),
                    }
                )
        if out:
            return out
    text = str(scene.get("narration") or "").strip() or "..."
    return [{"speaker": "heros", "text": text}]


_EXTRA_HERO_LINES = [
    "Le vent soufflait doucement entre les arbres.",
    "Les étoiles commençaient à briller dans le ciel.",
    "Un parfum de fleurs sauvages flottait dans l'air.",
    "Le sentier serpentait à travers la forêt enchantée.",
]
_EXTRA_FRIEND_LINES = [
    "Continuons notre chemin, l'aventure n'est pas finie.",
    "Regarde, là-bas, quelque chose scintille.",
    "Chaque pas nous rapproche de la fin de l'histoire.",
    "La nuit tombe doucement sur la forêt.",
]


def _extra_unique_lines(scene_idx: int, hero: str, round_i: int) -> list[dict[str, str]]:
    """Répliques bonus narratives (sans métadonnées ni salutations)."""
    hi = (scene_idx + round_i) % len(_EXTRA_HERO_LINES)
    fi = (scene_idx + round_i) % len(_EXTRA_FRIEND_LINES)
    return [
        {"speaker": "heros", "text": _EXTRA_HERO_LINES[hi]},
        {"speaker": "ami", "text": _EXTRA_FRIEND_LINES[fi]},
    ]


def _atempo_file(src: Path, dest: Path, speed: float) -> None:
    """Accelere l'audio (1.05-1.1) sans changer le pitch trop agressivement."""
    speed = max(1.01, min(1.15, float(speed)))
    # Chainer atempo si > 2.0 jamais ici ; 1.01-1.15 = un seul filtre
    dest.parent.mkdir(parents=True, exist_ok=True)
    rate = TTS_SAMPLE_RATE if TTS_SAMPLE_RATE in {24000, 44100, 48000} else 44100
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-filter:a",
        f"atempo={speed:.4f}",
        "-ar",
        str(rate),
        "-ac",
        "1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        TTS_MP3_BITRATE,
        str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _trim_audio(src: Path, dest: Path, max_sec: float) -> None:
    """Coupe dure a max_sec."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    rate = TTS_SAMPLE_RATE if TTS_SAMPLE_RATE in {24000, 44100, 48000} else 44100
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-t",
        f"{max(1.0, max_sec):.3f}",
        "-ar",
        str(rate),
        "-ac",
        "1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        TTS_MP3_BITRATE,
        str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _fit_audio_to_target(
    audio_dir: Path,
    timings: list[dict[str, Any]],
    full_audio: Path,
    target_sec: float,
    tolerance: float = 5.0,
) -> tuple[list[dict[str, Any]], float]:
    """
    Si total > cible+tolerance : accelere (1.05-1.1) puis coupe dure si besoin.
    Retourne timings mis a jour + duree finale.
    """
    total = sum(float(t["duration_sec"]) for t in timings)
    if target_sec <= 0 or total <= target_sec + tolerance:
        return timings, total

    # Vitesse cible pour entrer pile dans target_sec
    speed = min(1.10, max(1.05, total / max(1.0, target_sec)))
    new_timings: list[dict[str, Any]] = []
    for t in timings:
        src = audio_dir / str(t["file"])
        tmp = audio_dir / f"speed_{t['file']}"
        _atempo_file(src, tmp, speed)
        tmp.replace(src)
        d = _ffprobe_duration(src)
        nt = dict(t)
        nt["duration_sec"] = round(d, 3)
        new_timings.append(nt)

    # Reconstruire narration
    concat_list = audio_dir / "list.txt"
    concat_list.write_text(
        "\n".join(f"file '{t['file']}'" for t in new_timings) + "\n", encoding="utf-8"
    )
    full_raw = audio_dir / "narration_fit_raw.mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c",
            "copy",
            str(full_raw),
        ],
        check=True,
        cwd=str(audio_dir),
        capture_output=True,
    )
    total2 = _ffprobe_duration(full_raw)
    if total2 > target_sec + tolerance:
        _trim_audio(full_raw, full_audio, target_sec)
        # Repartir la coupe proportionnellement sur la derniere scene
        overflow = total2 - target_sec
        if new_timings:
            last = new_timings[-1]
            last_path = audio_dir / str(last["file"])
            keep = max(1.0, float(last["duration_sec"]) - overflow)
            _trim_audio(last_path, last_path, keep)
            last["duration_sec"] = round(_ffprobe_duration(last_path), 3)
        total2 = _ffprobe_duration(full_audio)
    else:
        _reencode_hq(full_raw, full_audio)
        total2 = _ffprobe_duration(full_audio)
    try:
        full_raw.unlink(missing_ok=True)
    except OSError:
        pass
    return new_timings, total2


def generate_audio(
    video_id: int,
    voice: str | None = None,
    rate: str | None = None,
    pitch: str | None = None,
) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = resolve_project_dir(video_id, video)
    board_path = projet / "storyboard.json"
    if not board_path.exists():
        raise FileNotFoundError("storyboard.json manquant.")

    board = json.loads(board_path.read_text(encoding="utf-8"))
    audio_dir = projet / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    pref = _voice_preference_from_voice(voice)
    if voice in {"femme", "homme", "auto"}:
        pref = voice
    voice_map = voices_for_preference(pref)

    age = normalize_age(str(board.get("age_group") or "1-10"))
    yprofile = youth_profile(age)
    rate = _normalize_tts_rate(rate or str(yprofile.get("tts_rate") or TTS_RATE))
    pitch = _normalize_tts_pitch(pitch or str(yprofile.get("tts_pitch") or TTS_PITCH))
    hero_name = str(board.get("hero") or board.get("theme") or "héros")
    target_sec = float(board.get("duration_min") or TARGET_DURATION_MIN) * 60.0

    def _render_all() -> tuple[list[dict[str, Any]], float]:
        timings: list[dict[str, Any]] = []
        for scene in board["scenes"]:
            idx = int(scene["index"])
            dialogue = _dialogue_for_scene(scene)
            scene["dialogue"] = dialogue
            part_files: list[str] = []
            scene_dur = 0.0
            for li, line in enumerate(dialogue):
                speaker = str(line.get("speaker") or "heros")
                vox = voice_map.get(speaker) or voice_map.get("heros") or TTS_VOICE
                part_path = audio_dir / f"scene_{idx:03d}_line{li:02d}.mp3"
                asyncio.run(_synthesize(line["text"], part_path, vox, rate, pitch))
                d = _ffprobe_duration(part_path)
                scene_dur += d
                part_files.append(part_path.name)
                line["voice"] = vox
                line["duration_sec"] = round(d, 3)

            scene_path = audio_dir / f"scene_{idx:03d}.mp3"
            list_tmp = audio_dir / f"scene_{idx:03d}_list.txt"
            list_tmp.write_text(
                "\n".join(f"file '{p}'" for p in part_files) + "\n", encoding="utf-8"
            )
            # Re-concat + re-encode HQ (pas -c copy qui conserve des mp3 heterogenes)
            concat_tmp = audio_dir / f"scene_{idx:03d}_concat.mp3"
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(list_tmp),
                    "-c",
                    "copy",
                    str(concat_tmp),
                ],
                check=True,
                cwd=str(audio_dir),
                capture_output=True,
            )
            _reencode_hq(concat_tmp, scene_path)
            try:
                concat_tmp.unlink(missing_ok=True)
            except OSError:
                pass
            scene["audio_file"] = scene_path.name
            scene["duration_sec"] = round(scene_dur, 3)
            scene["narration"] = " ".join(d["text"] for d in dialogue)
            timings.append(
                {"index": idx, "duration_sec": scene["duration_sec"], "file": scene_path.name}
            )
        return timings, sum(t["duration_sec"] for t in timings)

    timings, total = _render_all()

    # Allonger SEULEMENT si trop court (ne jamais depasser la cible)
    topup_round = 0
    while target_sec > 0 and total < target_sec * 0.92 and topup_round < 4:
        # Estimer ~8s par paire de repliques bonus — ne pas topup si on depasserait
        if total + 8.0 > target_sec * 1.02:
            break
        topup_round += 1
        scene = min(board["scenes"], key=lambda s: float(s.get("duration_sec") or 0))
        idx = int(scene["index"])
        extra = _extra_unique_lines(idx, hero_name, topup_round)
        dialogue = _dialogue_for_scene(scene) + extra
        scene["dialogue"] = dialogue
        log_event(
            video_id,
            "info",
            f"Allonge dialogue scène {idx} (round {topup_round}) pour viser {target_sec/60:.1f} min.",
        )
        timings, total = _render_all()
        if total > target_sec + 5:
            break

    concat_list = audio_dir / "list.txt"
    concat_list.write_text(
        "\n".join(f"file '{t['file']}'" for t in timings) + "\n", encoding="utf-8"
    )
    full_raw = audio_dir / "narration_concat.mp3"
    full_audio = audio_dir / "narration.mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c",
            "copy",
            str(full_raw),
        ],
        check=True,
        cwd=str(audio_dir),
        capture_output=True,
    )
    _reencode_hq(full_raw, full_audio)
    try:
        full_raw.unlink(missing_ok=True)
    except OSError:
        pass

    # Si trop long : atempo 1.05-1.1 puis coupe dure a cible (+/- 5s)
    if target_sec > 0 and total > target_sec + 5:
        log_event(
            video_id,
            "info",
            f"Audio {total:.0f}s > cible {target_sec:.0f}s — acceleration/coupe…",
        )
        timings, total = _fit_audio_to_target(
            audio_dir, timings, full_audio, target_sec, tolerance=5.0
        )
        # Sync durees scenes
        by_idx = {int(t["index"]): t for t in timings}
        for scene in board["scenes"]:
            t = by_idx.get(int(scene["index"]))
            if t:
                scene["duration_sec"] = t["duration_sec"]

    if target_sec > 0 and total < target_sec * 0.85:
        log_event(
            video_id,
            "warn",
            f"Audio {total/60:.1f} min < cible {target_sec/60:.1f} min (sans boucle).",
        )
    elif target_sec > 0:
        delta = abs(total - target_sec)
        log_event(
            video_id,
            "info",
            f"Duree audio calée : {total:.1f}s (cible {target_sec:.0f}s, Δ={delta:.1f}s).",
        )

    board["timings"] = timings
    board["total_audio_sec"] = round(total, 3)
    board["target_audio_sec"] = round(target_sec, 3)
    board["voice_preference"] = pref
    board["tts_sample_rate"] = TTS_SAMPLE_RATE
    board["tts_bitrate"] = TTS_MP3_BITRATE
    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")

    update_video(video_id, statut="audio_ok", duree_sec=total)
    log_event(
        video_id,
        "info",
        (
            f"Dialogues HQ : {total/60:.1f} min "
            f"(voix={voice_map.get('heros')}/{voice_map.get('ami')}, "
            f"{rate}, {pitch}, {TTS_SAMPLE_RATE}Hz {TTS_MP3_BITRATE})."
        ),
    )
    return {"ok": True, "total_sec": total, "audio": str(full_audio), "scenes": len(timings)}
