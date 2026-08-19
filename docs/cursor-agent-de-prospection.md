# Travailler sur Agent-de-propspection dans Cursor

## Pourquoi « Lancer la prospection » ne fait rien

Si vous **ouvrez `prospection.html` en double-clic** (fichier local), le bouton ne peut pas appeler l'API BODACC : il n'y a pas de serveur Node.js.

**Solution :**

```bash
git clone https://github.com/urdirditfurd/Agent-de-propspection.git
cd Agent-de-propspection
npm install
npm start
```

Puis ouvrez **http://localhost:3000/prospection** (pas le fichier HTML directement).

## Pointer Cursor sur Agent-de-propspection

### Option A — Agent Cloud (recommandé)

1. Cursor → **Settings** → **Cloud Agents** → **Environments**
2. **Add repository** : `urdirditfurd/Agent-de-propspection`
3. Lancez un **nouvel agent** depuis ce repo (pas depuis mon-site)
4. L'agent aura les droits git sur ce dépôt

Ajoutez aussi ce fichier à la racine du repo :

`.cursor/environment.json` (copiez depuis `docs/agent-de-prospection-cursor/environment.json` sur mon-site)

### Option B — Cursor local (bureau)

1. **File → Open Folder**
2. Sélectionnez le dossier cloné `Agent-de-propspection`
3. Terminal intégré : `npm install && npm start`

## Mettre à jour Agent-de-propspection (correctif bouton)

Copiez ces fichiers depuis la branche `cursor/prospection-ui-improvements-0325` de **mon-site** :

| Cible sur Agent-de-propspection | URL |
|--------------------------------|-----|
| `prospection.js` | https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/prospection.js |
| `prospection.html` | https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/prospection.html |
| `package.json` | https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/docs/agent-de-prospection-package.json |
| `.cursor/environment.json` | https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/docs/agent-de-prospection-cursor/environment.json |

Puis commit + push sur GitHub.

## Ce que fait le correctif

- Détecte l'ouverture en fichier local (`file://`)
- Affiche un bandeau « lancez npm start »
- Connecte l'API sur `http://localhost:3000` même en mode fichier
- Message clair si le serveur n'est pas démarré
