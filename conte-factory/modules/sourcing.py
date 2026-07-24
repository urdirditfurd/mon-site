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
    # Marge +25 % : dialogues + pauses TTS → viser la durée réelle demandée
    return max(100, int(round(duration_min * WORDS_PER_MINUTE * 1.25)))


def _title_from_theme(theme: str) -> str:
    clean = re.sub(r"\s+", " ", (theme or "").strip())
    if not clean:
        return "Conte du soir"
    short = clean[:70].rstrip(" ,.;:")
    return short[0].upper() + short[1:] if short else "Conte du soir"


def _friend_name(subject: str) -> str:
    return "Lumi l'étoile"


def _dialogue_scenes(subject: str, lesson: str, scenes_n: int) -> list[list[dict[str, str]]]:
    """Scènes = répliques jouées par les personnages (pas de narrateur VO)."""
    s = subject
    ami = _friend_name(subject)
    n = max(4, int(scenes_n))

    # Paires de répliques progressives (héros / ami) — contenu unique
    pairs: list[list[dict[str, str]]] = [
        [
            {"speaker": "heros", "text": f"Bonsoir… C'est moi, {s}. Ce soir, je vais te raconter mon aventure."},
            {"speaker": "ami", "text": f"Je t'écoute, {s} ! Montre-moi le ciel et ton courage."},
        ],
        [
            {"speaker": "heros", "text": f"Regarde ces nuages moelleux. Je, {s}, vais m'élancer tout doucement."},
            {"speaker": "ami", "text": f"Vas-y, {s}. Je vole juste à côté de toi."},
        ],
        [
            {"speaker": "heros", "text": f"Le vent chante. Mes ailes — les ailes de {s} — battent la mesure."},
            {"speaker": "ami", "text": "Quelles belles couleurs ! Continue, je te suis."},
        ],
        [
            {"speaker": "heros", "text": f"Plus haut… Oh ! Une porte de nuages roses. Je, {s}, passe le premier."},
            {"speaker": "ami", "text": f"Après toi, {s}. Quel monde magique !"},
        ],
        [
            {"speaker": "heros", "text": f"Toi, {ami}, tu es mon ami. Ensemble on est plus forts."},
            {"speaker": "ami", "text": f"Je crois en toi, {s}. Dis-moi ce que tu veux accomplir."},
        ],
        [
            {"speaker": "heros", "text": f"Je veux voler librement et cracher mon feu bleu, comme {s} sait le faire."},
            {"speaker": "ami", "text": "Alors montre-moi. Doucement, pour les enfants qui écoutent."},
        ],
        [
            {"speaker": "heros", "text": "Attends… Un petit nuage bloque le passage. J'ai un doute."},
            {"speaker": "ami", "text": f"Respire, {s}. Tu as déjà traversé tant de choses."},
        ],
        [
            {"speaker": "heros", "text": f"Tu as raison. Moi, {s}, je contourne l'obstacle avec patience."},
            {"speaker": "ami", "text": "Bravo ! Chaque geste est le tien, unique."},
        ],
        [
            {"speaker": "heros", "text": "Une lumière bleue danse autour de moi. Elle me guide."},
            {"speaker": "ami", "text": f"Suis-la, {s}. Elle aime ton feu bleu."},
        ],
        [
            {"speaker": "heros", "text": f"Une étoile timide ! Bonjour petite étoile, je suis {s}."},
            {"speaker": "ami", "text": "Elle a besoin d'aide. On l'accompagne ?"},
            {"speaker": "heros", "text": "Oui. Aider fait partie de qui je suis."},
        ],
        [
            {"speaker": "heros", "text": "Le vent devient capricieux… Mais je tiens bon."},
            {"speaker": "ami", "text": f"Solide et tendre à la fois — c'est toi, {s}."},
        ],
        [
            {"speaker": "heros", "text": "Je me souviens de ma force intérieure. Mes ailes s'ouvrent grand."},
            {"speaker": "ami", "text": "Montre ta magie ! Celle qui n'appartient qu'à toi."},
        ],
        [
            {"speaker": "heros", "text": f"Voici mon feu bleu ! Moi, {s}, j'illumine les nuages."},
            {"speaker": "ami", "text": "Magnifique ! Les nuages applaudissent presque."},
            {"speaker": "choeur", "text": f"Bravo {s} ! Bravo !"},
        ],
        [
            {"speaker": "heros", "text": "Un dernier défi… Je n'ai pas peur. J'écoute mon cœur."},
            {"speaker": "ami", "text": f"C'est ta vraie force, {s}."},
        ],
        [
            {"speaker": "heros", "text": "J'ai réussi ! Le ciel s'ouvre en couleurs chaudes."},
            {"speaker": "ami", "text": f"Tu rayonnes, {s}. Quelle joie calme !"},
            {"speaker": "choeur", "text": f"Bravo, {s} !"},
        ],
        [
            {"speaker": "heros", "text": f"Sur le chemin du retour, je comprends : {lesson}."},
            {"speaker": "ami", "text": "Cette leçon t'appartient. Et elle réchauffe les cœurs."},
        ],
        [
            {"speaker": "heros", "text": "La nuit m'enveloppe comme une couverture. Tout est paisible."},
            {"speaker": "ami", "text": f"Bonne nuit, {s}. On pense à toi en sécurité."},
        ],
        [
            {"speaker": "heros", "text": "Avant de dormir, je te dis merci d'avoir voyagé avec moi."},
            {"speaker": "ami", "text": "Une seule histoire, jusqu'au bout — sans recommencer."},
            {"speaker": "heros", "text": f"Dors bien. Moi, {s}, je veille un instant… puis je rêve."},
        ],
    ]

    # Répartir n scènes sur l'arc sans recyclage
    if n <= len(pairs):
        chosen: list[list[dict[str, str]]] = []
        used: set[int] = set()
        for i in range(n):
            idx = int(round(i * (len(pairs) - 1) / max(1, n - 1)))
            while idx in used and idx < len(pairs) - 1:
                idx += 1
            while idx in used and idx > 0:
                idx -= 1
            used.add(idx)
            chosen.append(pairs[idx])
        return chosen

    out = [list(p) for p in pairs]
    extra = 0
    while len(out) < n:
        extra += 1
        out.append(
            [
                {
                    "speaker": "heros",
                    "text": (
                        f"Chapitre bonus {extra} : je découvre un détail du ciel "
                        f"jamais vu, et moi {s} j'avance encore un peu."
                    ),
                },
                {
                    "speaker": "ami",
                    "text": f"Oui {s}, continue — c'est nouveau, pas une reprise.",
                },
            ]
        )
    return out[:n]


def _lines_to_script(scenes: list[list[dict[str, str]]]) -> str:
    blocks: list[str] = []
    for scene in scenes:
        lines = []
        for line in scene:
            sp = str(line.get("speaker") or "heros").upper()
            lines.append(f"[{sp}] {line.get('text') or ''}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _enrich_dialogue_to_duration(
    scenes: list[list[dict[str, str]]],
    subject: str,
    duration_min: float,
) -> list[list[dict[str, str]]]:
    """Allonge les répliques jusqu'au budget mots — sans recycler l'arc."""
    target = _target_words(duration_min)
    extras_heros = [
        f"Je sens le vent sur mon visage — le visage de {subject}.",
        f"Chaque battement d'aile dit mon nom : {subject}.",
        "Je parle doucement, pour que tu m'entendes bien.",
        "Regarde bien ce que je fais maintenant.",
        "Je ne suis pas un autre animal : c'est vraiment moi.",
    ]
    extras_ami = [
        f"Je te vois clairement, {subject}.",
        "Continue, je reste avec toi.",
        "Les enfants t'écoutent avec le cœur.",
        "C'est beau, et ce n'est pas effrayant.",
        f"Raconte encore un peu, {subject}.",
    ]

    def total_words() -> int:
        return _word_count(_lines_to_script(scenes))

    guard = 0
    while total_words() < target and guard < 100:
        si = guard % len(scenes)
        scene = scenes[si]
        speaker = "heros" if guard % 2 == 0 else "ami"
        pool = extras_heros if speaker == "heros" else extras_ami
        bit = pool[(si + guard) % len(pool)]
        # Enrichir une réplique existante du bon speaker, sinon ajouter
        enriched = False
        for line in scene:
            if line.get("speaker") == speaker:
                line["text"] = f"{line['text']} {bit}"
                enriched = True
                break
        if not enriched:
            scene.append({"speaker": speaker, "text": bit})
        guard += 1
    return scenes


def _builtin_story(
    theme: str | None = None,
    age_group: str = "1-9",
    duration_min: float | None = None,
    style_key: str = "aquarelle",
) -> dict[str, Any]:
    minutes = float(duration_min if duration_min is not None else TARGET_DURATION_MIN)
    subject = (theme or "une créature magique douce").strip()
    hero = subject
    place = "un ciel de nuages moelleux"
    lesson = random.choice(LESSONS)
    scenes_n = scene_count_for_duration(minutes, age_group=age_group)
    titre = _title_from_theme(subject)

    dialogue_scenes = _enrich_dialogue_to_duration(
        _dialogue_scenes(subject, lesson, scenes_n),
        subject,
        minutes,
    )
    script = _lines_to_script(dialogue_scenes)

    return {
        "titre": titre,
        "theme": subject,
        "morale": lesson,
        "script": script,
        "dialogue_scenes": dialogue_scenes,
        "hero": hero,
        "friend": _friend_name(subject),
        "place": place,
        "age_group": age_group,
        "duration_min": minutes,
        "target_scenes": scenes_n,
        "style_key": style_key,
        "visual_style": style_prompt(style_key),
        "word_count": _word_count(script),
        "format": "dialogue",
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
    prompt = f"""Écris un conte DIALOGUÉ pour enfants ({age_group} ans), en français.
Durée cible parlée : ~{minutes} minutes (~{words} mots).
Sujet UNIQUE obligatoire : « {subject} » (c'est le héros qui parle).
Format : {n} scènes. Chaque scène = répliques [HEROS] / [AMI] (pas de narrateur).
Réponds UNIQUEMENT en JSON :
{{"titre":"...","theme":"...","morale":"...","script":"[HEROS] ...\\n[AMI] ...\\n\\n[HEROS] ...","hero":"...","place":"..."}}
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
            f"Conte DIALOGUE enfants FR ({age_group} ans) ~{minutes} min. "
            f"Sujet UNIQUE: {subject}. Format [HEROS]/[AMI], {n} scenes. "
            f"JSON: titre, theme, morale, script, hero, place."
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
        "friend": story.get("friend"),
        "place": story.get("place"),
        "script": script,
        "dialogue_scenes": story.get("dialogue_scenes") or [],
        "format": story.get("format") or "dialogue",
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
