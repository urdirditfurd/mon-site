"""Assemblage FFmpeg : clips Wan + audio TTS → MP4 final.

Attend un storyboard.json avec audio_path + video_path (absolus de préférence).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from config import EXPORTS_DIR, MUSIC_DIR, MUSIC_VOLUME, ROOT, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH


class VideoAssembler:
    def __init__(self) -> None:
        self.root = ROOT
        self.exports = EXPORTS_DIR
        self.exports.mkdir(parents=True, exist_ok=True)
        self.last_result: dict[str, Any] = {}

    def _abs(self, maybe: str | Path | None, base: Path) -> Path | None:
        if not maybe:
            return None
        p = Path(str(maybe))
        if not p.is_absolute():
            p = (base / p).resolve()
            if not p.exists():
                p = (self.root / str(maybe)).resolve()
        return p if p.exists() else None

    def _ffprobe_duration(self, path: Path) -> float:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            text=True,
        ).strip()
        return float(out)

    def _fit_clip(self, src: Path, duration: float, out: Path) -> None:
        cmd = [
            "ffmpeg",
            "-y",
            "-stream_loop",
            "-1",
            "-i",
            str(src),
            "-t",
            f"{duration:.3f}",
            "-vf",
            f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,"
            f"pad={VIDEO_WIDTH}:{VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps={VIDEO_FPS},format=yuv420p",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            str(out),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout or "ffmpeg fit failed")[-1500:])

    def _mux(self, video: Path, audio: Path, out: Path) -> None:
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(video),
            "-i",
            str(audio),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            str(out),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout or "ffmpeg mux failed")[-1500:])

    def _find_music(self) -> Path | None:
        for ext in ("*.mp3", "*.m4a", "*.wav", "*.ogg"):
            files = sorted(MUSIC_DIR.glob(ext))
            if files:
                return files[0]
        return None

    def assemble_video(
        self,
        storyboard_path: str | Path | dict[str, Any],
        video_id: int,
        background_music: str | None = None,
    ) -> str | None:
        """Retourne le chemin MP4 ou None. Details dans self.last_result."""
        if isinstance(storyboard_path, dict):
            tmp = self.exports / f"_tmp_storyboard_{video_id}.json"
            tmp.write_text(
                json.dumps(storyboard_path, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            storyboard_path = tmp

        path = Path(storyboard_path)
        if not path.is_absolute():
            path = (self.root / path).resolve()
        if not path.exists():
            self.last_result = {"ok": False, "errors": [f"Storyboard introuvable: {path}"]}
            return None

        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            self.last_result = {"ok": False, "errors": ["storyboard.json invalide"]}
            return None

        base = path.parent
        work = base / "montage"
        work.mkdir(parents=True, exist_ok=True)
        errors: list[str] = []
        parts: list[Path] = []

        for scene in list(data.get("scenes") or []):
            numero = int(scene.get("numero") or scene.get("index") or 0)
            audio = self._abs(scene.get("audio_path"), base)
            video = self._abs(scene.get("video_path"), base)
            if not audio or not video:
                if not video and audio:
                    errors.append(
                        f"Scene {numero}: chemin manquant "
                        "(audio OK, video absente — lance Generer les clips video)"
                    )
                    continue
                errors.append(f"Scene {numero}: chemin manquant")
                continue

            try:
                duration = float(
                    scene.get("duree_estimee")
                    or scene.get("duration_sec")
                    or self._ffprobe_duration(audio)
                )
                fitted = work / f"fitted_{numero:03d}.mp4"
                muxed = work / f"scene_{numero:03d}.mp4"
                self._fit_clip(video, duration, fitted)
                self._mux(fitted, audio, muxed)
                parts.append(muxed)
            except Exception as exc:
                errors.append(f"Scene {numero}: {exc}")

        if not parts:
            self.last_result = {
                "ok": False,
                "errors": errors or ["Aucune scene valide a assembler"],
                "output": None,
            }
            return None

        concat_list = work / "concat.txt"
        concat_list.write_text(
            "".join(f"file '{p.resolve().as_posix()}'\n" for p in parts),
            encoding="utf-8",
        )
        raw = work / "raw_concat.mp4"
        proc = subprocess.run(
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
                str(raw),
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            self.last_result = {
                "ok": False,
                "errors": errors + [(proc.stderr or proc.stdout or "concat failed")[-1500:]],
                "output": None,
            }
            return None

        out = self.exports / f"video_{video_id}.mp4"
        music = self._abs(background_music, self.root) if background_music else None
        if music is None:
            music = self._find_music()

        if music:
            final_cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(raw),
                "-stream_loop",
                "-1",
                "-i",
                str(music),
                "-filter_complex",
                f"[1:a]volume={MUSIC_VOLUME}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]",
                "-map",
                "0:v",
                "-map",
                "[a]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-shortest",
                str(out),
            ]
        else:
            final_cmd = ["ffmpeg", "-y", "-i", str(raw), "-c", "copy", str(out)]

        proc = subprocess.run(final_cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not out.exists() or out.stat().st_size < 1000:
            self.last_result = {
                "ok": False,
                "errors": errors
                + [(proc.stderr or proc.stdout or "export final failed")[-1500:]],
                "output": None,
            }
            return None

        self.last_result = {
            "ok": True,
            "output": str(out),
            "scenes_ok": len(parts),
            "errors": errors,
        }
        return str(out)
