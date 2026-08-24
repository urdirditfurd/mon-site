# Agent de prospection

## En une phrase

Un agent qui **trouve les cabinets d’expertise comptable** (NAF **69.20Z**), **retrouve leurs contacts** publics (e-mail ou téléphone) via des sources gratuites, et **prépare des messages de prospection** signés au **nom de la société**.

---

## Ce qu’il fait

### 1. Recensement des cabinets

- Interroge l’**API Recherche d’entreprises (SIRENE)** — entreprises **actives**, **toutes dates de création**
- Cible **uniquement** les cabinets d’expertise comptable (NAF `69.20Z`)
- Zones : **Île-de-France**, départements IDF, **villes** (ex. Asnières-sur-Seine, Gennevilliers, Colombes…)
- Enrichit chaque fiche (SIREN, adresse, dirigeant)

### 2. Recherche de contacts (double vérification)

- Cherche un **e-mail** ou un **téléphone** public pour chaque cabinet
- Sources gratuites : site officiel, Pages Jaunes, OSM, snippets publics, etc.
- Filet final : teasers Pappers / Societe.com / SIREN exclus ; NAF recontrôlé avant publication

### 3. Prospection

- Modèle personnalisable : `{entreprise}`, `{dirigeant}`, `{activite}`, `{adresse}`
- Signature : **Nom de la société** (+ e-mail / téléphone)
- Envoi mail / SMS, export CSV, mémoire des contactées

---

## Interface

- Accueil + Recherche
- Cible verrouillée : cabinets d’expertise comptable
- Zone (région / département / ville) — plus de filtre « Créées depuis »
- Signature société

URL VPS : https://51-254-135-158.sslip.io/prospection

---

## Public cible

Équipes qui **démarchent les cabinets d’expertise comptable** (partenariats, offres B2B, etc.).

---

## Fichiers

| Fichier | Rôle |
|---------|------|
| `agent-prospection/index.html` | UI |
| `agent-prospection/prospection.js` | Front |
| `agent-prospection/server/prospection-agent.js` | Agent + API |
| `agent-prospection/server/standalone-server.js` | Serveur dédié |
