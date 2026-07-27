"""P5 — Templates de mouvement fluide pour prompts I2V."""

from __future__ import annotations

import re

MOTION_TEMPLATES: dict[str, str] = {
    "marche": (
        "character walking slowly forward a few steps then pauses, "
        "smooth motion, stable background, gentle camera follow, no sudden cuts"
    ),
    "regarde": (
        "character looking around slowly, subtle head turn once, "
        "static background, soft eye movement, then holds still"
    ),
    "court": (
        "character runs a few light steps then slows and stops, "
        "camera tracking gently, stable scenery, no morphing"
    ),
    "danse": (
        "character dances gracefully with one short turn then stops smiling, "
        "fluid motion, consistent lighting, no looping spin"
    ),
    "cueille": (
        "character bends once to pick a flower then stands upright again, "
        "gentle motion, locked background trees"
    ),
    "parle": (
        "character speaks with gentle lip movement then becomes still, "
        "minimal body sway, stable face identity"
    ),
    "apparait": (
        "character steps into frame from behind a tree then stands still watching, "
        "slow reveal, no teleport morph"
    ),
    "ecoute": (
        "character listens attentively, small nod once, then relaxes, "
        "static camera, stable environment"
    ),
    "frappe": (
        "character knocks once on the door with one hand then lowers the hand and waits, "
        "stable door and background, no morphing"
    ),
    "recule": (
        "character takes one careful step back in surprise then freezes watching, "
        "stable room, no teleport"
    ),
    "etreinte": (
        "character gently hugs once then holds still smiling softly, "
        "calm motion, consistent faces, no morphing"
    ),
    "pointe": (
        "character points once toward a side path then lowers the arm, "
        "small gesture only, stable forest background"
    ),
}


def resolve_motion_template(action_type: str | None, action_text: str = "") -> str:
    key = (action_type or "").strip().lower()
    if key in MOTION_TEMPLATES:
        return MOTION_TEMPLATES[key]
    blob = f"{key} {action_text}".lower()
    for name, tmpl in MOTION_TEMPLATES.items():
        if name in blob:
            return tmpl
    # Heuristique FR/EN depuis le texte d'action / narration
    if re.search(r"\b(knock|frappe|toc)\b", blob):
        return MOTION_TEMPLATES["frappe"]
    if re.search(r"\b(hug|embrace|etreinte|étreinte|serre)\b", blob):
        return MOTION_TEMPLATES["etreinte"]
    if re.search(r"\b(step back|recule|steps back)\b", blob):
        return MOTION_TEMPLATES["recule"]
    if re.search(r"\b(point|pointe)\b", blob):
        return MOTION_TEMPLATES["pointe"]
    if re.search(r"\b(walk|marche|cueill)\b", blob):
        return MOTION_TEMPLATES["marche"]
    if re.search(r"\b(run|court|fuit)\b", blob):
        return MOTION_TEMPLATES["court"]
    if re.search(r"\b(danc|danse)\b", blob):
        return MOTION_TEMPLATES["danse"]
    if re.search(r"\b(appear|apparait|apparaît|steps out)\b", blob):
        return MOTION_TEMPLATES["apparait"]
    if re.search(r"\b(listen|ecoute|écoute)\b", blob):
        return MOTION_TEMPLATES["ecoute"]
    return MOTION_TEMPLATES["regarde"]


def build_fluid_prompt(action_type: str | None, scene_context: str, action_text: str = "") -> str:
    motion = resolve_motion_template(action_type, action_text)
    ctx = (scene_context or "").strip().strip(" .,;")
    suffix = "no sudden cuts, no morphing, consistent lighting, stable anatomy"
    parts = [p for p in (ctx, motion, suffix) if p]
    return ". ".join(parts)
