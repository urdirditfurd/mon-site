"""Étape 3 — Dialogues multi-voix (personnages) + durée réelle cible.

Pas de narrateur VO unique : chaque réplique = voix du personnage.
Si l'audio est trop court vs la durée demandée, on ajoute des répliques
UNIQUE (jamais de boucle audio).
"""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from config import TARGET_DURATION_MIN, TTS_PITCH, TTS_RATE, TTS_VOICE
from db.database import get_video, log_event, update_video
from modules.creative_options import voices_for_preference


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


def _soften_text(text: str) -> str:
    t = " ".join((text or "").split())
    if not t:
        return "..."
    t = re.sub(r"([.!?…])\s+", r"\1 ... ", t)
    return t.strip()


async def _synthesize(text: str, out_path: Path, voice: str, rate: str, pitch: str) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(
        text=_soften_text(text),
        voice=voice,
        rate=rate,
        pitch=pitch,
    )
    await communicate.save(str(out_path))


def _voice_preference_from_voice(voice: str | None) -> str:
    v = (voice or "").lower()
    if "henri" in v or "homme" in v:
        return "homme"
    if "denise" in v or "femme" in v or "eloise" in v:
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


def _extra_unique_lines(scene_idx: int, hero: str, round_i: int) -> list[dict[str, str]]:
    """Répliques bonus pour allonger jusqu'à la durée — contenu nouveau."""
    return [
        {
            "speaker": "heros",
            "text": (
                f"Encore un instant… Moi, {hero}, je te confie un secret de la scène {scene_idx} "
                f"numéro {round_i} : le ciel change encore un peu pour moi."
            ),
        },
        {
            "speaker": "ami",
            "text": (
                f"Je t'écoute, {hero}. Ce n'est pas une reprise : c'est la suite, "
                f"tout doucement, pour atteindre la fin du conte."
            ),
        },
    ]


def generate_audio(
    video_id: int,
    voice: str | None = None,
    rate: str | None = None,
    pitch: str | None = None,
) -> dict[str, Any]:
    video = get_video(video_id)
    if not video:
        raise ValueError(f"Vidéo introuvable: {video_id}")
    projet = Path(video["chemin_projet"])
    board_path = projet / "storyboard.json"
    if not board_path.exists():
        raise FileNotFoundError("storyboard.json manquant.")

    board = json.loads(board_path.read_text(encoding="utf-8"))
    audio_dir = projet / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    # voice arg = préférence UI (femme/homme) OU nom Edge-TTS legacy
    pref = _voice_preference_from_voice(voice)
    if voice in {"femme", "homme", "auto"}:
        pref = voice
    voice_map = voices_for_preference(pref)
    rate = rate or TTS_RATE
    pitch = pitch or TTS_PITCH
    hero_name = str(board.get("hero") or board.get("theme") or "héros")
    target_sec = float(board.get("duration_min") or TARGET_DURATION_MIN) * 60.0

    def _render_all() -> tuple[list[dict[str, Any]], float]:
        timings: list[dict[str, Any]] = []
        lines_concat: list[str] = []
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
                lines_concat.append(f"file '{part_path.name}'")
                line["voice"] = vox
                line["duration_sec"] = round(d, 3)

            # Concat lignes → scene_XXX.mp3
            scene_path = audio_dir / f"scene_{idx:03d}.mp3"
            list_tmp = audio_dir / f"scene_{idx:03d}_list.txt"
            list_tmp.write_text(
                "\n".join(f"file '{p}'" for p in part_files) + "\n", encoding="utf-8"
            )
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
                    str(scene_path),
                ],
                check=True,
                cwd=str(audio_dir),
                capture_output=True,
            )
            scene["audio_file"] = scene_path.name
            scene["duration_sec"] = round(scene_dur, 3)
            scene["narration"] = " ".join(d["text"] for d in dialogue)
            timings.append(
                {"index": idx, "duration_sec": scene["duration_sec"], "file": scene_path.name}
            )
        return timings, sum(t["duration_sec"] for t in timings)

    timings, total = _render_all()

    # Allonger avec répliques UNIQUE si trop court (pas de boucle)
    topup_round = 0
    while target_sec > 0 and total < target_sec * 0.92 and topup_round < 4:
        topup_round += 1
        # Ajouter 2 répliques à la scène la plus courte relative
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

    concat_list = audio_dir / "list.txt"
    concat_list.write_text(
        "\n".join(f"file '{t['file']}'" for t in timings) + "\n", encoding="utf-8"
    )
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
            str(full_audio),
        ],
        check=True,
        cwd=str(audio_dir),
        capture_output=True,
    )

    if target_sec > 0 and total < target_sec * 0.85:
        log_event(
            video_id,
            "warn",
            f"Audio {total/60:.1f} min < cible {target_sec/60:.1f} min (sans boucle).",
        )

    board["timings"] = timings
    board["total_audio_sec"] = round(total, 3)
    board["voice_preference"] = pref
    board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")

    update_video(video_id, statut="audio_ok", duree_sec=total)
    log_event(
        video_id,
        "info",
        f"Dialogues prêts : {total/60:.1f} min (héros/ami, {rate}, {pitch}).",
    )
    return {"ok": True, "total_sec": total, "audio": str(full_audio), "scenes": len(timings)}
