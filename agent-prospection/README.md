# Agent de prospection

Module autonome du site mon-site.

## Contenu

```
agent-prospection/
├── index.html              # Interface
├── prospection.js          # Front (SSE, mails, CSV)
├── favicon.png             # Icône onglet
├── apple-touch-icon.png
└── server/
    ├── prospection-agent.js
    ├── prospection-agent.test.js
    └── standalone-server.js
```

## Tester

```bash
npm start
# → http://localhost:3000/prospection
```

Ou uniquement ce module :

```bash
npm run start:prospection
```
