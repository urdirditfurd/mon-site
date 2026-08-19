# Agent de prospection

## En une phrase

Un agent IA qui **trouve les nouvelles entreprises** d'un secteur choisi, **retrouve leurs contacts** (e-mail ou téléphone) via des sources publiques gratuites, et **prépare des mails de prospection** personnalisés pour proposer vos services de gestion comptable.

---

## Ce qu'il fait

### 1. Recensement des nouvelles entreprises

- Interroge le **BODACC** (annonces légales de création d'entreprises)
- Filtre par **secteur** (restauration, BTP, conseil, beauté, etc.) ou secteur libre
- Filtre par **période** (7 à 90 jours) et **département** (101 départements français)
- Enrichit chaque fiche via l'**Annuaire des entreprises** (SIREN, NAF, adresse, dirigeant)

### 2. Recherche de contacts

- Cherche automatiquement un **e-mail** ou un **téléphone** public pour chaque entreprise
- Sources utilisées (100 % gratuites, sans clé API) :
  - Devinette d'e-mail par enregistrement MX DNS
  - OpenStreetMap Nominatim
  - PagesJaunes
  - Brave Search
  - Societe.com
  - Recherche par nom du dirigeant

### 3. Prospection par e-mail

- **Modèle de mail type** personnalisable avec variables : `{entreprise}`, `{dirigeant}`, `{activite}`, `{adresse}`
- **Aperçu** du mail pour la 1ère entreprise trouvée
- **Édition individuelle** du mail par entreprise
- **Envoi en masse** : sélection multiple + ouverture des fenêtres mailto
- **Export CSV** de toutes les entreprises et contacts

---

## Interface

- Thème clair blanc / orange
- Formulaire sticky à gauche, résultats à droite
- Bouton **retour en haut** en scroll
- Barre d'actions : tout sélectionner, relire/modifier, envoyer
- Journal en temps réel pendant la recherche

---

## Exemple de résultat

| Critère | Exemple |
|---------|---------|
| Secteur | Conseil, gestion, juridique |
| Zone | Paris (75) |
| Période | 30 jours |
| Entreprises trouvées | 20+ |
| Avec contact | 24 (e-mails et/ou téléphones) |

---

## Points forts

- **Gratuit** : aucune clé API, aucun abonnement
- **Illimité** : pas de plafond sur le nombre de résultats
- **Autonome** : l'utilisateur choisit le secteur, lance l'agent, relit les mails et envoie
- **Conforme** : sources publiques officielles (BODACC, Annuaire entreprises)

---

## Public cible

Experts-comptables, cabinets comptables et conseillers qui souhaitent **prospecter les nouvelles entreprises** de leur région pour proposer un accompagnement en gestion comptable dès la création.

---

## Fichiers du projet

| Fichier | Rôle |
|---------|------|
| `prospection.html` | Interface (HTML + CSS) |
| `prospection.js` | Logique front (recherche, mails, export) |
| `server/prospection-agent.js` | Agent IA (BODACC, contacts, SSE) |
| `server/prospection-server.js` | Serveur minimal standalone (repo Agent-de-propspection) |
| `server/index.js` | Serveur Express complet ClipForge (mon-site) |

Pour le repo **Agent-de-propspection** autonome, copiez `server/prospection-server.js` en `server/index.js` et lancez `npm start`.

---

## Lancer l'agent en local

```bash
npm install
npm start
```

Puis ouvrir : **http://localhost:3000/prospection**

---

## Déploiement (Render)

Le projet inclut un `render.yaml`. Déployez sur Render : l'agent sera accessible à :

`https://votre-app.onrender.com/prospection`

> GitHub Pages ne suffit pas : l'agent nécessite le backend Node.js pour interroger BODACC et enrichir les contacts.

---

## API

| Endpoint | Description |
|----------|-------------|
| `GET /prospection` | Page interface |
| `GET /api/prospection/sectors` | Liste des secteurs |
| `GET /api/prospection/stream?sector=...&days=...&department=...` | Recherche en streaming (SSE) |
| `POST /api/prospection/search` | Recherche synchrone (JSON) |
