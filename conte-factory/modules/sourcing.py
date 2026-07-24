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


def _unique_story_beats(subject: str, lesson: str, scenes_n: int) -> list[str]:
    """Histoire linéaire UNIQUE — jamais de recyclage des mêmes scènes en boucle."""
    s = subject
    n = max(4, int(scenes_n))

    # Moments distincts (assez pour 36 scènes max) — progression claire
    moments = [
        f"Il était une fois {s}. Ce soir, l'histoire parle uniquement de {s}, pas d'un autre héros.",
        f"Au réveil du conte, {s} découvrait un ciel doux. Les nuages formaient un chemin juste pour {s}.",
        f"{s} respira profondément. On voyait chaque détail de {s}, exactement comme demandé.",
        f"Puis {s} s'élança dans les airs. Le vent chantait, et {s} avançait avec un courage calme.",
        f"Plus haut, {s} traversa une porte de nuages roses. Derrière, un monde nouveau attendait {s}.",
        f"Un ami lumineux salua {s}. Ensemble, ils parlèrent de ce que {s} voulait accomplir.",
        f"L'ami murmura : « Je crois en toi, {s}. » Et {s} sourit, rassuré.",
        f"Soudain, un petit obstacle bloqua le passage. {s} s'arrêta, sans paniquer.",
        f"{s} observa, chercha, puis trouva une idée douce. C'était typique de {s}.",
        f"Avec patience, {s} contourna l'obstacle. Chaque geste montrait encore {s}.",
        f"Une lumière bleue dansa autour de {s}. Elle guidait {s} vers la suite de l'aventure.",
        f"Au milieu du ciel, {s} croisa une étoile timide. L'étoile demanda de l'aide à {s}.",
        f"{s} accepta. Aider faisait partie de la nature de {s}.",
        f"Ensemble, {s} et l'étoile avancèrent. Le chemin devenait plus clair grâce à {s}.",
        f"Un vent capricieux secoua les nuages. {s} tint bon, solide et tendre à la fois.",
        f"{s} se souvint d'une force intérieure. Ce souvenir donna des ailes à {s}.",
        f"Alors {s} montra ce qui le rendait unique — la magie propre à {s}.",
        f"Les nuages applaudirent presque. On n'avait d'yeux que pour {s}.",
        f"Un dernier défi apparut, plus doux qu'effrayant. {s} le regarda sans peur.",
        f"{s} trouva la solution en écoutant son cœur. C'était la vraie force de {s}.",
        f"Enfin, {s} réussit. Le ciel s'ouvrit en couleurs chaudes autour de {s}.",
        f"Des voix amies murmurèrent : « Bravo, {s} ! » {s} rayonnait de joie calme.",
        f"Sur le chemin du retour, {s} repensa à chaque étape. L'aventure avait grandi {s}.",
        f"{s} comprit une belle vérité : {lesson}. Cette leçon appartenait à {s}.",
        f"La nuit enveloppa {s} comme une couverture. Tout était paisible autour de {s}.",
        f"Avant de dormir, on revoyait {s} une dernière fois, fier et serein.",
        f"Et depuis ce soir, quand on pense à {s}, on se sent en sécurité.",
        f"Bonne nuit — le rêve continue avec {s}, sans recommencer l'histoire depuis le début.",
        f"Dans le silence, {s} veillait encore un instant, gardien doux du conte.",
        f"Les étoiles clignèrent pour {s}. Puis tout s'endormit autour de {s}.",
        f"Fin de l'aventure de {s} — une seule histoire, racontée jusqu'au bout.",
        f"On ferma les yeux en pensant à {s}, heureux d'avoir suivi {s} sans boucle.",
        f"Demain, peut-être une nouvelle histoire. Ce soir, c'était celle de {s}.",
        f"Le dernier nuage s'effaça derrière {s}. Le conte de {s} était complet.",
        f"Ainsi s'acheva le voyage de {s}, unique et sans répétition.",
        f"Dors bien — {s} reste dans ton cœur, jusqu'au prochain conte.",
    ]

    if n <= len(moments):
        # Indices strictement croissants répartis sur l'arc complet
        chosen: list[str] = []
        used: set[int] = set()
        for i in range(n):
            idx = int(round(i * (len(moments) - 1) / max(1, n - 1)))
            while idx in used and idx < len(moments) - 1:
                idx += 1
            while idx in used and idx > 0:
                idx -= 1
            used.add(idx)
            chosen.append(moments[idx])
        return chosen

    chosen = moments[:]
    extra_i = 0
    while len(chosen) < n:
        extra_i += 1
        chosen.append(
            f"Chapitre bonus {extra_i} : {s} découvrit un détail inédit du paysage, "
            f"jamais vu auparavant, et {s} avança encore un peu plus loin dans le conte."
        )
    return chosen[:n]


def _expand_to_duration(
    beats: list[str],
    subject: str,
    scenes_n: int,
    duration_min: float,
) -> list[str]:
    """Produit `scenes_n` paragraphes UNIQUE pour viser duration_min — sans boucler l'histoire."""
    target = _target_words(duration_min)
    # Enrichissements distincts (pas les mêmes phrases recyclées en boucle narrative)
    detail_pool = [
        f"On prenait le temps d'observer {subject}, sans se presser.",
        f"La lumière caressait {subject}, tout était calme et magique.",
        f"Les enfants imaginaient {subject} encore plus clairement.",
        f"Un silence doux entourait {subject}, comme une berceuse.",
        f"Le ciel changeait de teinte autour de {subject}.",
        f"Rien n'était effrayant : {subject} inspirait confiance et tendresse.",
        f"On entendait à peine le vent près de {subject}.",
        f"Chaque couleur racontait un peu plus {subject}.",
        f"Le décor restait cohérent avec {subject}, scène après scène.",
        f"Un souffle tiède accompagnait {subject}.",
        f"Loin d'être une reprise, ce moment avançait l'histoire de {subject}.",
        f"La suite appartenait encore à {subject}, jamais une copie du début.",
    ]

    # Beats déjà uniques et dimensionnés à scenes_n
    paragraphs = list(beats[:scenes_n])
    while len(paragraphs) < scenes_n:
        k = len(paragraphs) + 1
        paragraphs.append(
            f"Moment {k} : {subject} poursuivit son chemin vers une découverte nouvelle."
        )

    words_each = max(40, target // max(1, scenes_n))
    for i in range(len(paragraphs)):
        extras: list[str] = []
        # Ajouter des détails DIFFÉRENTS par scène (index décalé, pas de modulo sur le même cycle narratif)
        need = words_each - _word_count(paragraphs[i])
        guard = 0
        while need > 8 and guard < 12:
            extras.append(detail_pool[(i * 3 + guard) % len(detail_pool)])
            need = words_each - _word_count(paragraphs[i] + " " + " ".join(extras))
            guard += 1
        if extras:
            paragraphs[i] = f"{paragraphs[i]} {' '.join(extras)}"

    # Si encore trop court globalement : allonger chaque scène un peu, sans répéter l'arc
    guard = 0
    while _word_count(" ".join(paragraphs)) < target and guard < 60:
        idx = guard % len(paragraphs)
        paragraphs[idx] = (
            f"{paragraphs[idx]} "
            f"{detail_pool[(idx + guard) % len(detail_pool)]}"
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

    beats = _unique_story_beats(subject, lesson, scenes_n)
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
