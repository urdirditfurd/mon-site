"""Étape 1 — Créer une histoire originale et éviter les doublons."""

from __future__ import annotations

import json
import random
from typing import Any

import requests

from config import (
    MISTRAL_API_KEY,
    OLLAMA_URL,
    STORY_MODE,
    TARGET_DURATION_MIN,
    scene_count_for_duration,
    scene_sec_for_audience,
)
from db.database import create_video, find_by_hash, fingerprint, log_event, project_dir, similar_title_exists, update_video

HEROES = [
    "un petit lapin blanc nommé Léo",
    "une oursonne curieuse nommée Mila",
    "un renardeau roux nommé Nino",
    "une petite chouette sage nommée Luna",
    "un hérisson maladroit nommé Pomme",
    "une faon timide nommée Étoile",
]

PLACES = [
    "une forêt enchantée aux arbres lumineux",
    "un village de nuages mous comme des coussins",
    "une rivière qui chante la nuit",
    "un jardin secret derrière une porte d'étoiles",
    "une montagne de confettis dorés",
    "une île flottante pleine de lanternes",
]

QUESTS = [
    "retrouver la Lune endormie",
    "rendre le sourire à un dragon trop timide",
    "réparer l'horloge des saisons",
    "apporter de la lumière à une grotte inquiète",
    "retrouver le trésor de la gentillesse",
    "aider les étoiles à retrouver leur chemin",
]

LESSONS = [
    "le courage grandit quand on s'entraide",
    "être différent est une force",
    "la patience ouvre les plus belles portes",
    "un petit geste peut changer une grande journée",
    "la vérité douce répare les cœurs",
    "l'amitié éclaire même la nuit la plus sombre",
]


def _builtin_story(
    theme: str | None = None,
    age_group: str = "1-9",
) -> dict[str, Any]:
    hero = random.choice(HEROES)
    place = random.choice(PLACES)
    if theme and theme.strip():
        quest = f"vivre une aventure autour de : {theme.strip()}"
    else:
        quest = random.choice(QUESTS)
    lesson = random.choice(LESSONS)
    scenes_n = scene_count_for_duration(age_group=age_group)

    hero_name = hero.split("nommé")[-1].split("nommée")[-1].strip().title()
    titre = f"L'aventure de {hero_name}"
    if theme:
        titre = f"{titre} — {theme[:48].rstrip()}"

    place_phrase = place if not place.startswith("une ") else place
    # « près de une » → « près d'une »
    near = f"près d'{place_phrase[4:]}" if place_phrase.startswith("une ") else f"près de {place_phrase}"

    # Histoire longue structurée : intro → voyage → épreuves → climax → morale
    parts = [
        f"Il était une fois {hero}, qui vivait {near}. "
        f"Chaque soir, avant de dormir, il rêvait d'une grande aventure.",
        f"Un matin, un message magique arriva : il fallait {quest}. "
        f"Le cœur battant, notre héros se prépara avec un petit sac rempli de courage.",
        f"Sur le chemin, les arbres murmuraient des conseils doux. "
        f"Des amis inattendus apparurent : un papillon guide, une tortue patiente, un écureuil rieur.",
        f"Mais bientôt, un obstacle se dressa. Le vent soufflait fort, et la peur voulait s'installer. "
        f"Alors {hero} respira profondément et se souvint que l'on n'est jamais vraiment seul.",
        f"Ensemble, ils trouvèrent une idée brillante. Chacun apporta son talent : "
        f"l'un écoutait, l'autre consolait, un autre inventait une ruse gentille.",
        f"Après de nombreuses étapes, le but était presque atteint. "
        f"Il restait une dernière épreuve : faire confiance et partager ce que l'on a de plus précieux.",
        f"Enfin, la mission fut réussie. La magie de {place} brilla plus fort que jamais. "
        f"Tout le monde dansa, rit, et se promit de se revoir.",
        f"En rentrant, {hero} comprit une belle vérité : {lesson}. "
        f"Et depuis ce jour, chaque nuit devient une nouvelle histoire pleine de lumière. "
        f"Bonne nuit, petits rêveurs.",
    ]

    # Étendre pour viser ~30 min de narration (répétitions narratives riches)
    expanded: list[str] = []
    while len(expanded) < scenes_n:
        for i, part in enumerate(parts):
            detail = (
                f" Dans cette partie du voyage, les couleurs changent doucement, "
                f"les sons de la nature deviennent une berceuse, et le cœur se sent en sécurité. "
                f"On avance pas à pas, scène après scène, vers la réussite de la quête : {quest}."
            )
            expanded.append(part + detail)
            if len(expanded) >= scenes_n:
                break

    script = "\n\n".join(expanded[:scenes_n])
    return {
        "titre": titre,
        "theme": quest,
        "morale": lesson,
        "script": script,
        "hero": hero,
        "place": place,
    }


def _mistral_story(
    theme: str | None = None,
    age_group: str = "1-9",
) -> dict[str, Any]:
    if not MISTRAL_API_KEY:
        return _builtin_story(theme, age_group=age_group)
    n = scene_count_for_duration(age_group=age_group)
    prompt = f"""Écris un conte original pour enfants ({age_group} ans), en français, d'environ {TARGET_DURATION_MIN} minutes à voix haute.
Thème demandé : {theme or "aventure douce et magique"}.
Réponds UNIQUEMENT en JSON :
{{"titre":"...","theme":"...","morale":"...","script":"texte long découpé en paragraphes","hero":"...","place":"..."}}
Le script doit contenir environ {n} paragraphes riches, calmes, sans violence (conte du soir)."""
    resp = requests.post(
        "https://api.mistral.ai/v1/chat/completions",
        headers={"Authorization": f"Bearer {MISTRAL_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "mistral-small-latest",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.8,
            "response_format": {"type": "json_object"},
        },
        timeout=120,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    data = json.loads(content)
    if not data.get("script"):
        return _builtin_story(theme, age_group=age_group)
    return {
        "titre": data.get("titre") or "Conte magique",
        "theme": data.get("theme") or (theme or "aventure"),
        "morale": data.get("morale") or "",
        "script": data["script"],
        "hero": data.get("hero") or "",
        "place": data.get("place") or "",
    }


def _ollama_story(
    theme: str | None = None,
    age_group: str = "1-9",
) -> dict[str, Any]:
    try:
        n = scene_count_for_duration(age_group=age_group)
        prompt = (
            f"Écris un conte enfants FR ({age_group} ans) ~{TARGET_DURATION_MIN} min. "
            f"Thème: {theme or 'magie douce'}. "
            f"JSON uniquement: titre, theme, morale, script ({n} paragraphes), hero, place."
        )
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": "llama3.2", "prompt": prompt, "stream": False, "format": "json"},
            timeout=180,
        )
        resp.raise_for_status()
        data = json.loads(resp.json().get("response") or "{}")
        if not data.get("script"):
            return _builtin_story(theme, age_group=age_group)
        return data
    except Exception:
        return _builtin_story(theme, age_group=age_group)


def generate_story(
    theme: str | None = None,
    age_group: str = "1-9",
) -> dict[str, Any]:
    mode = STORY_MODE.lower()
    if mode == "mistral":
        return _mistral_story(theme, age_group=age_group)
    if mode == "ollama":
        return _ollama_story(theme, age_group=age_group)
    return _builtin_story(theme, age_group=age_group)


def source_new_video(
    theme: str | None = None,
    age_group: str = "1-9",
) -> dict[str, Any]:
    """Crée un nouveau projet si l'histoire n'existe pas déjà."""
    age_group = (age_group or "1-9").strip().lower()
    story = generate_story(theme, age_group=age_group)
    target_scenes = scene_count_for_duration(age_group=age_group)
    scene_target_sec = scene_sec_for_audience(age_group)
    script = str(story["script"]).strip()
    titre = str(story["titre"]).strip()
    hash_script = fingerprint(script)

    existing = find_by_hash(hash_script)
    if existing:
        log_event(existing["id"], "warn", "Histoire déjà connue (même empreinte).")
        return {"ok": False, "reason": "doublon_hash", "video": existing}

    if similar_title_exists(titre):
        # Légère variation du titre pour débloquer
        titre = f"{titre} ({random.randint(2, 99)})"

    # Création provisoire pour obtenir l'id / dossier
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
        "duration_min": TARGET_DURATION_MIN,
        "target_scenes": target_scenes,
        "scene_target_sec": scene_target_sec,
    }
    (projet / "story.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (projet / "script.txt").write_text(script, encoding="utf-8")
    log_event(
        video_id,
        "info",
        f"Script enregistré ({target_scenes} scènes prévues, public {age_group}).",
    )
    return {"ok": True, "video_id": video_id, "projet": str(projet), "story": payload}
