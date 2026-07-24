"""Étape 1 — Histoire centrée sur le thème utilisateur, durée réelle cible."""

from __future__ import annotations

import json
import random
import re
from typing import Any

import requests

from config import (
    MISTRAL_API_KEY,
    OLLAMA_URL,
    STORY_MODE,
    TARGET_DURATION_MIN,
    scene_count_for_duration,
)
from db.database import (
    create_video,
    find_by_hash,
    fingerprint,
    log_event,
    project_dir,
    similar_title_exists,
    update_video,
)
from modules.creative_options import WORDS_PER_MINUTE, style_prompt

LESSONS = [
    "le courage grandit quand on s'entraide",
    "être différent est une force",
    "la patience ouvre les plus belles portes",
    "un petit geste peut changer une grande journée",
    "la vérité douce répare les cœurs",
    "l'amitié éclaire même la nuit la plus sombre",
]


def _word_count(text: str) -> int:
    return len(re.findall(r"\w+", text, flags=re.UNICODE))


def _target_words(duration_min: float) -> int:
    # Marge +8 % pour atteindre la durée après pauses TTS
    return max(80, int(round(duration_min * WORDS_PER_MINUTE * 1.08)))


def _title_from_theme(theme: str) -> str:
    clean = re.sub(r"\s+", " ", (theme or "").strip())
    if not clean:
        return "Conte du soir"
    # Titre court lisible
    short = clean[:70].rstrip(" ,.;:")
    return short[0].upper() + short[1:] if short else "Conte du soir"


def _beat_templates(subject: str, lesson: str) -> list[str]:
    """Beats narratifs qui REPETENT et développent le sujet demandé."""
    s = subject
    return [
        (
            f"Il était une fois {s}. "
            f"Ce n'était pas une histoire d'un autre animal : c'était vraiment {s}, "
            f"au cœur de notre conte. Avant de dormir, écoute bien ce qui lui arrive."
        ),
        (
            f"Ce soir-là, {s} regardait le ciel. "
            f"Les nuages bougeaient doucement, et {s} sentait une envie d'aventure. "
            f"On voyait clairement {s}, exactement comme dans le thème de l'histoire."
        ),
        (
            f"Alors {s} s'élança. "
            f"On entendait le vent, on voyait le mouvement, et {s} avançait avec courage. "
            f"Chaque détail rappelait {s} : les couleurs, le geste, l'élan."
        ),
        (
            f"Sur le chemin, {s} rencontra un ami gentil. "
            f"Ensemble, ils parlèrent de {s} et de ce qu'il voulait accomplir. "
            f"L'ami dit : « Je suis fier de toi, {s} »."
        ),
        (
            f"Mais un petit obstacle apparut. "
            f"{s} eut un instant de doute. Puis {s} respira, se souvint de sa force, "
            f"et continua. Car cette histoire parle bien de {s}."
        ),
        (
            f"Avec douceur, {s} trouva une idée brillante. "
            f"Il utilisa ce qui le rendait unique — justement ce qui fait de {s} un héros. "
            f"Les nuages semblaient applaudir {s}."
        ),
        (
            f"Enfin, {s} réussit. "
            f"On le voyait rayonnant : {s} avait traversé l'aventure. "
            f"Tout le monde murmura : « Bravo, {s} ! »"
        ),
        (
            f"En rentrant, {s} comprit une belle vérité : {lesson}. "
            f"Et depuis ce jour, quand on pense à {s}, on se sent en sécurité. "
            f"Bonne nuit — l'histoire de {s} continue dans les rêves."
        ),
    ]


def _expand_to_duration(
    beats: list[str],
    subject: str,
    scenes_n: int,
    duration_min: float,
) -> list[str]:
    """Produit `scenes_n` paragraphes assez riches pour viser duration_min."""
    target = _target_words(duration_min)
    fillers = [
        f"On prenait le temps d'observer {subject}, sans se presser.",
        f"La lumière caressait {subject}, tout était calme et magique.",
        f"Les enfants imaginaient {subject} encore plus clairement.",
        f"Un silence doux entourait {subject}, comme une berceuse.",
        f"Et {subject} avançait, pas après pas, scène après scène.",
        f"Rien n'était effrayant : {subject} inspirait confiance et tendresse.",
    ]

    paragraphs: list[str] = []
    i = 0
    while len(paragraphs) < scenes_n:
        base = beats[i % len(beats)]
        extra = " ".join(fillers[(i + k) % len(fillers)] for k in range(2))
        paragraphs.append(f"{base} {extra}")
        i += 1

    # Enrichir jusqu'à atteindre le volume de mots cible
    guard = 0
    while _word_count(" ".join(paragraphs)) < target and guard < 80:
        idx = guard % len(paragraphs)
        paragraphs[idx] = (
            f"{paragraphs[idx]} "
            f"{fillers[guard % len(fillers)]} "
            f"Oui, cette scène parle encore de {subject}."
        )
        guard += 1

    return paragraphs[:scenes_n]


def _builtin_story(
    theme: str | None = None,
    age_group: str = "1-9",
    duration_min: float | None = None,
    style_key: str = "aquarelle",
) -> dict[str, Any]:
    minutes = float(duration_min if duration_min is not None else TARGET_DURATION_MIN)
    subject = (theme or "une créature magique douce").strip()
    # Le thème utilisateur EST le sujet (pas un lapin aléatoire)
    hero = subject
    place = "un ciel de nuages moelleux"
    lesson = random.choice(LESSONS)
    scenes_n = scene_count_for_duration(minutes, age_group=age_group)
    titre = _title_from_theme(subject)

    beats = _beat_templates(subject, lesson)
    paragraphs = _expand_to_duration(beats, subject, scenes_n, minutes)
    script = "\n\n".join(paragraphs)

    return {
        "titre": titre,
        "theme": subject,
        "morale": lesson,
        "script": script,
        "hero": hero,
        "place": place,
        "age_group": age_group,
        "duration_min": minutes,
        "target_scenes": scenes_n,
        "style_key": style_key,
        "visual_style": style_prompt(style_key),
        "word_count": _word_count(script),
    }


def _mistral_story(
    theme: str | None = None,
    age_group: str = "1-9",
    duration_min: float | None = None,
    style_key: str = "aquarelle",
) -> dict[str, Any]:
    if not MISTRAL_API_KEY:
        return _builtin_story(theme, age_group, duration_min, style_key)
    minutes = float(duration_min if duration_min is not None else TARGET_DURATION_MIN)
    n = scene_count_for_duration(minutes, age_group=age_group)
    words = _target_words(minutes)
    subject = (theme or "aventure douce et magique").strip()
    prompt = f"""Écris un conte ORIGINAL pour enfants ({age_group} ans), en français.
Durée cible à voix haute : environ {minutes} minutes (~{words} mots).
Le sujet PRINCIPAL et UNIQUE de l'histoire DOIT être exactement : « {subject} ».
Le héros est ce sujet (pas un autre animal inventé). Répète le sujet dans chaque paragraphe.
Réponds UNIQUEMENT en JSON :
{{"titre":"...","theme":"...","morale":"...","script":"texte découpé en {n} paragraphes","hero":"...","place":"..."}}
Ton calme, sans violence, adapté au coucher."""
    resp = requests.post(
        "https://api.mistral.ai/v1/chat/completions",
        headers={"Authorization": f"Bearer {MISTRAL_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "mistral-small-latest",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "response_format": {"type": "json_object"},
        },
        timeout=120,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    data = json.loads(content)
    if not data.get("script"):
        return _builtin_story(theme, age_group, duration_min, style_key)
    return {
        "titre": data.get("titre") or _title_from_theme(subject),
        "theme": subject,
        "morale": data.get("morale") or "",
        "script": data["script"],
        "hero": data.get("hero") or subject,
        "place": data.get("place") or "",
        "age_group": age_group,
        "duration_min": minutes,
        "target_scenes": n,
        "style_key": style_key,
        "visual_style": style_prompt(style_key),
    }


def _ollama_story(
    theme: str | None = None,
    age_group: str = "1-9",
    duration_min: float | None = None,
    style_key: str = "aquarelle",
) -> dict[str, Any]:
    try:
        minutes = float(duration_min if duration_min is not None else TARGET_DURATION_MIN)
        n = scene_count_for_duration(minutes, age_group=age_group)
        subject = (theme or "magie douce").strip()
        prompt = (
            f"Conte enfants FR ({age_group} ans) ~{minutes} min. "
            f"Sujet UNIQUE obligatoire: {subject}. "
            f"JSON: titre, theme, morale, script ({n} paragraphes parlant de {subject}), hero, place."
        )
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": "llama3.2", "prompt": prompt, "stream": False, "format": "json"},
            timeout=180,
        )
        resp.raise_for_status()
        data = json.loads(resp.json().get("response") or "{}")
        if not data.get("script"):
            return _builtin_story(theme, age_group, duration_min, style_key)
        data["theme"] = subject
        data["hero"] = data.get("hero") or subject
        data["duration_min"] = minutes
        data["target_scenes"] = n
        data["style_key"] = style_key
        data["visual_style"] = style_prompt(style_key)
        return data
    except Exception:
        return _builtin_story(theme, age_group, duration_min, style_key)


def generate_story(
    theme: str | None = None,
    age_group: str = "1-9",
    duration_min: float | None = None,
    style_key: str = "aquarelle",
) -> dict[str, Any]:
    mode = STORY_MODE.lower()
    if mode == "mistral":
        return _mistral_story(theme, age_group, duration_min, style_key)
    if mode == "ollama":
        return _ollama_story(theme, age_group, duration_min, style_key)
    return _builtin_story(theme, age_group, duration_min, style_key)


def source_new_video(
    theme: str | None = None,
    age_group: str = "1-9",
    duration_min: float | None = None,
    style_key: str = "aquarelle",
    aspect: str = "16:9",
    music: str = "berceuse",
) -> dict[str, Any]:
    """Crée un nouveau projet si l'histoire n'existe pas déjà."""
    age_group = (age_group or "1-9").strip().lower()
    minutes = float(duration_min if duration_min is not None else TARGET_DURATION_MIN)
    story = generate_story(
        theme, age_group=age_group, duration_min=minutes, style_key=style_key
    )
    target_scenes = int(story.get("target_scenes") or scene_count_for_duration(minutes, age_group))
    script = str(story["script"]).strip()
    titre = str(story["titre"]).strip()
    hash_script = fingerprint(script)

    existing = find_by_hash(hash_script)
    if existing:
        log_event(existing["id"], "warn", "Histoire déjà connue (même empreinte).")
        return {"ok": False, "reason": "doublon_hash", "video": existing}

    if similar_title_exists(titre):
        titre = f"{titre} ({random.randint(2, 99)})"

    video_id = create_video(
        titre=titre,
        titre_original=str(story.get("titre") or titre),
        theme=str(story.get("theme") or theme or ""),
        hash_script=hash_script,
        chemin_projet="",
    )
    projet = project_dir(video_id)
    update_video(video_id, chemin_projet=str(projet), statut="script_ok")

    payload = {
        "id": video_id,
        "titre": titre,
        "theme": story.get("theme"),
        "morale": story.get("morale"),
        "hero": story.get("hero"),
        "place": story.get("place"),
        "script": script,
        "hash_script": hash_script,
        "age_group": age_group,
        "duration_min": minutes,
        "target_scenes": target_scenes,
        "style_key": style_key,
        "visual_style": story.get("visual_style") or style_prompt(style_key),
        "aspect": aspect,
        "music": music,
        "word_count": story.get("word_count") or _word_count(script),
    }
    (projet / "story.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (projet / "script.txt").write_text(script, encoding="utf-8")
    log_event(
        video_id,
        "info",
        f"Script thème-centré : {target_scenes} scènes, ~{payload['word_count']} mots, {minutes} min cibles.",
    )
    return {"ok": True, "video_id": video_id, "projet": str(projet), "story": payload}
