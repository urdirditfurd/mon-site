"""Prompts I2V anti-boucle + decoupage en clips courts (3-5 s).

Chaque clip = 1 action, 1 camera, progression lineaire, pas de loop.
"""

from __future__ import annotations

import re
from typing import Any

from modules.character_lock import apply_character_lock
from modules.motion_prompts import build_fluid_prompt, resolve_motion_template
from modules.style_lock import apply_style_lock, normalize_style_key
from modules.youth_spec import normalize_age, youth_profile


# Suffixe obligatoire sur tous les prompts motion I2V
ANTI_LOOP_SUFFIX = (
    "continuous single sequence shot, linear progression without loops, "
    "no repetition, no infinite actions, stable anatomy, "
    "no morphing or deformation, clear beginning and clear ending"
)

ALLOWED_CAMERAS: tuple[str, ...] = (
    "static camera shot",
    "slow pan left to right",
    "slow pan right to left",
    "slow zoom in",
    "zoom out smoothly",
)

# Actions infinies / repetitives a reformuler
_INFINITE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b(dancing|dance|dances)\b", re.I), "starts dancing briefly, then stops and stands still"),
    (re.compile(r"\b(running|runs|run)\b", re.I), "starts running a few steps, then slows to a walk and stops"),
    (re.compile(r"\b(flying|flies|fly)\b", re.I), "lifts off gently, glides forward, then lands softly"),
    (re.compile(r"\b(singing|sings|sing)\b", re.I), "opens mouth to sing one short phrase, then smiles and closes mouth"),
    (re.compile(r"\b(walking|walks|walk)\b", re.I), "takes a few steps forward, then pauses and looks ahead"),
    (re.compile(r"\b(jumping|jumps|jump)\b", re.I), "makes one small jump, lands, and steadies balance"),
    (re.compile(r"\b(spinning|spins|spin)\b", re.I), "turns halfway around once, then faces forward again"),
    (re.compile(r"\b(waving|waves|wave)\b", re.I), "raises hand to wave once, then lowers arm gently"),
    (re.compile(r"\b(laughing|laughs|laugh)\b", re.I), "laughs softly once, then settles with a calm smile"),
    (re.compile(r"\b(crying|cries|cry)\b", re.I), "wipes a tear, takes a breath, then looks hopeful"),
    (re.compile(r"\b(swimming|swims|swim)\b", re.I), "paddles forward briefly, then floats calmly"),
    (re.compile(r"\b(chanting|chants|chant)\b", re.I), "chants one short line, then becomes silent"),
)

_MULTI_SCENE_FORBIDDEN = re.compile(
    r"\b(then\s+)?(cut\s+to|meanwhile|later|suddenly\s+in|another\s+scene|"
    r"next\s+scene|switch\s+to|in\s+another\s+room|at\s+the\s+castle\s+and)\b",
    re.I,
)


def clip_span_sec(age_group: str | None = "1-10") -> float:
    """Duree cible d'un clip structure (3-5 s)."""
    profile = youth_profile(age_group)
    span = float(profile.get("wan_clip_span_sec") or 4.0)
    return max(3.0, min(5.0, span))


# Plafond pratique RTX 3080 : 3 clips courts / scene narrative
MAX_CLIPS_PER_SCENE = 3


def ensure_camera(camera: str | None, clip_index: int = 0) -> str:
    """Camera obligatoire : defaut static, sinon mouvement simple autorise."""
    raw = (camera or "").strip().lower()
    if not raw:
        return ALLOWED_CAMERAS[clip_index % len(ALLOWED_CAMERAS)]
    for allowed in ALLOWED_CAMERAS:
        if allowed in raw or raw in allowed:
            return allowed
    # Mouvement non autorise -> static
    if any(
        bad in raw
        for bad in (
            "whip",
            "shake",
            "orbit",
            "360",
            "chaos",
            "fast",
            "handheld",
            "dutch",
            "roll",
        )
    ):
        return "static camera shot"
    return ALLOWED_CAMERAS[clip_index % len(ALLOWED_CAMERAS)]


def finish_action(action: str) -> str:
    """
    Transforme une action en sequence avec debut et fin.
    Ex: "a boy dancing" -> "a boy starts dancing, then stops and looks at the sky"
    """
    text = " ".join((action or "").split()).strip().lstrip(". ,;")
    if not text:
        return "character takes a calm breath, then looks gently at the camera and holds still"
    if _MULTI_SCENE_FORBIDDEN.search(text):
        text = _MULTI_SCENE_FORBIDDEN.sub("", text).strip(" ,.")
        text = text.lstrip(". ,;")
    for pattern, replacement in _INFINITE_PATTERNS:
        if pattern.search(text):
            # Garder le sujet si present
            if "starts " not in text.lower() and "then " not in text.lower():
                return f"character {replacement}, then holds still with a soft expression"
            return text
    if " then " in text.lower() or "starts " in text.lower():
        return text
    if text.lower().endswith("ing"):
        return f"{text} briefly, then stops and relaxes with a calm expression"
    return f"{text}, holds the pose briefly, then relaxes naturally"


def _action_from_narration(narration: str, clip_i: int, n_clips: int) -> str:
    """Derive une action unique par clip depuis la narration."""
    text = (narration or "").strip()
    if not text:
        return finish_action("character speaks softly with gentle hand gesture")
    # Decouper par phrases / virgules
    chunks = [c.strip() for c in re.split(r"[.!?…]+", text) if c.strip()]
    if not chunks:
        chunks = [text[:120]]
    chunk = chunks[clip_i % len(chunks)]
    verbs_fr = (
        ("court", "starts running a few steps, then stops"),
        ("marche", "walks a few steps forward, then pauses"),
        ("danse", "starts dancing briefly, then stops"),
        ("chante", "sings one short phrase, then smiles"),
        ("vole", "lifts off gently, glides, then lands"),
        ("regarde", "looks around with curiosity, then focuses ahead"),
        ("decouvre", "notices something nearby, leans closer, then smiles"),
        ("ouvre", "opens something carefully, peeks inside, then closes it"),
        ("entre", "steps into the scene, looks around, then stands still"),
        ("sort", "steps out slowly, pauses, then looks back"),
        ("appelle", "calls out once softly, then waits listening"),
        ("ecoute", "listens attentively, nods once, then relaxes"),
        ("sourit", "smiles warmly, blinks, then nods gently"),
        ("parle", "speaks with gentle lip movement, then becomes still"),
    )
    low = chunk.lower()
    for fr, en in verbs_fr:
        if fr in low:
            return finish_action(en)
    # Progression narrative sur les clips
    phases = (
        "character enters the frame calmly, looks around, then settles",
        "character reacts with gentle surprise, then softens expression",
        "character performs one clear gesture, then holds still",
        "character speaks expressively, then pauses thoughtfully",
        "character shifts weight slightly, then faces the camera calmly",
    )
    return finish_action(phases[clip_i % len(phases)])


def _description_for_clip(
    scene: dict[str, Any],
    board: dict[str, Any],
    clip_i: int,
) -> str:
    base = str(scene.get("visual_prompt") or scene.get("script_action") or "").strip()
    style_key = normalize_style_key(str(board.get("style_key") or "aquarelle"))
    hero = str(board.get("hero_description") or board.get("theme") or board.get("hero") or "")
    place = str(
        scene.get("lieu")
        or board.get("place")
        or "enchanted storybook setting"
    )
    if base and len(base) > 40:
        desc = base
    else:
        desc = (
            f"Children's storybook scene. Character: {hero}. "
            f"Setting: {place}. Single environment only."
        )
    desc = _MULTI_SCENE_FORBIDDEN.sub("", desc).strip(" ,.")
    desc = apply_style_lock(desc, style_key)
    desc = apply_character_lock(desc, board)
    return desc


def build_clip_plan(
    scene: dict[str, Any],
    board: dict[str, Any],
    clip_i: int,
    n_clips: int,
    *,
    scene_index: int,
) -> dict[str, Any]:
    """Structure {description, action, camera, duration} pour un clip."""
    age = normalize_age(str(board.get("age_group") or "1-10"))
    # Prefer duree script structuree (3-5s) si presente
    if scene.get("target_duration_sec") and float(scene["target_duration_sec"]) <= 5.5:
        dur = max(3.0, min(5.0, float(scene["target_duration_sec"])))
    else:
        dur = clip_span_sec(age)
    narration = str(scene.get("script_action") or scene.get("narration") or "")
    action_type = str(scene.get("action_type") or "")
    if scene.get("script_action"):
        # Motion template + heuristiques sur l'action EN du script (pas de contexte vide → ". foo")
        action = finish_action(
            build_fluid_prompt(action_type, "", str(scene.get("script_action") or narration))
        )
    else:
        action = _action_from_narration(narration, clip_i, n_clips)
        action = finish_action(
            resolve_motion_template(action_type, action) if action_type else action
        )
    camera = ensure_camera(str(scene.get("script_camera") or ""), clip_i + scene_index)
    description = _description_for_clip(scene, board, clip_i)
    return {
        "clip_index": clip_i + 1,
        "scene_index": int(scene.get("index") or scene_index + 1),
        "description": description,
        "action": action,
        "action_type": action_type or "regarde",
        "camera": camera,
        "duration": dur,
        "needs_reference_image": True,
        "reference_role": "init_frame",
    }


def build_clip_plans_for_scene(
    scene: dict[str, Any],
    board: dict[str, Any],
    scene_index: int = 0,
) -> list[dict[str, Any]]:
    """Decoupe une scene narrative en clips 3-5 s (1 action + 1 camera chacun)."""
    age = normalize_age(str(board.get("age_group") or "1-10"))
    span = clip_span_sec(age)
    audio_sec = float(
        scene.get("duration_sec")
        or scene.get("target_duration_sec")
        or board.get("youth_profile", {}).get("scene_target_sec")
        or 28.0
    )
    # Script structure : 1 clip = 1 scene (duree deja 3-5 s)
    if board.get("structured_script") or (
        scene.get("target_duration_sec") and float(scene["target_duration_sec"]) <= 5.5
        and scene.get("script_action")
    ):
        n_clips = 1
    else:
        n_clips = max(1, min(MAX_CLIPS_PER_SCENE, int(round(audio_sec / span))))
    return [
        build_clip_plan(scene, board, i, n_clips, scene_index=scene_index)
        for i in range(n_clips)
    ]


def build_clip_plans_for_board(board: dict[str, Any]) -> int:
    """Remplit scene['clip_plans'] pour toutes les scenes. Retourne total clips."""
    total = 0
    for i, scene in enumerate(board.get("scenes") or []):
        plans = build_clip_plans_for_scene(scene, board, scene_index=i)
        scene["clip_plans"] = plans
        scene["ai_clips_planned"] = len(plans)
        total += len(plans)
    board["clip_plan_total"] = total
    board["clip_span_sec"] = clip_span_sec(str(board.get("age_group") or "1-10"))
    return total


def enhance_motion_prompt(
    clip: dict[str, Any],
    *,
    visual_base: str = "",
    board: dict[str, Any] | None = None,
) -> str:
    """Prompt I2V final : style lock + character lock + action + camera + anti-loop."""
    board = board or {}
    style_key = normalize_style_key(str(board.get("style_key") or "aquarelle"))
    desc = str(clip.get("description") or visual_base or "").strip()
    action = finish_action(str(clip.get("action") or ""))
    camera = ensure_camera(str(clip.get("camera") or ""), int(clip.get("clip_index") or 0))
    motion = resolve_motion_template(str(clip.get("action_type") or ""), action)
    parts = [
        apply_style_lock(desc, style_key),
        apply_character_lock("", board) if board else "",
        f"Action: {action}",
        f"Motion: {motion}",
        f"Camera: {camera}",
        ANTI_LOOP_SUFFIX,
        "locked face identity, sharp facial features, preserve original face",
    ]
    return ". ".join(p for p in parts if p)


def enhance_image_prompt(clip: dict[str, Any], board: dict[str, Any]) -> str:
    """Prompt image de reference (init_frame) pour un clip."""
    style_key = normalize_style_key(str(board.get("style_key") or "aquarelle"))
    desc = str(clip.get("description") or "").strip()
    action = finish_action(str(clip.get("action") or ""))
    camera = ensure_camera(str(clip.get("camera") or ""), 0)
    if style_key == "3d_mignon":
        prefix = (
            "3D Pixar animation film still, single environment, one clear subject, "
            "cinematic composition, sharp focus, octane render quality"
        )
    else:
        prefix = (
            "children's storybook film still, single environment, "
            "one clear subject, sharp focus, soft lighting"
        )
    raw = (
        f"{prefix}. {desc}. "
        f"Frozen moment before action: {action}. {camera}. "
        f"{ANTI_LOOP_SUFFIX}. "
        f"no text, no watermark, stable anatomy"
    )
    return apply_character_lock(apply_style_lock(raw, style_key), board)


def flatten_clip_jobs(board: dict[str, Any]) -> list[dict[str, Any]]:
    """Liste aplatie de tous les clips a generer (pour pipeline I2V)."""
    jobs: list[dict[str, Any]] = []
    for si, scene in enumerate(board.get("scenes") or []):
        scene_idx = int(scene.get("index") or si + 1)
        plans = scene.get("clip_plans") or build_clip_plans_for_scene(scene, board, si)
        for ci, clip in enumerate(plans):
            jobs.append(
                {
                    "scene_index": scene_idx,
                    "scene_list_index": si,
                    "clip_index": int(clip.get("clip_index") or ci + 1),
                    "clip_plan": clip,
                    "scene": scene,
                }
            )
    return jobs
