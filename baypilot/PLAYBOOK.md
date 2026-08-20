# BayPilot — Playbook d’exécution (sans toucher au clone EBX)

Copie améliorée du cockpit, dossier `baypilot/`.  
Le clone VPS d’origine reste dans `ebx/` (branche `cursor/ebx-dashboard-0eb5`, PM2 `ebx`, port **3000**). **Ne pas** `git pull` cette branche dans `/var/www/ebx`, **ne pas** `pm2 restart ebx` pour BayPilot.

---

## 0. Règle d’or

| Instance | Dossier | PM2 | Port |
|---|---|---|---|
| Clone historique (ne pas modifier) | `/var/www/ebx/ebx` | `ebx` | 3000 |
| Opérateur DFY | `/var/www/baypilot/baypilot` | `baypilot-ops` | 3100 |
| Cockpit client N | `.../clients/<id>/` | `baypilot-<id>` | 3101+ |

---

## 1. Aujourd’hui (technique, 30–60 min)

1. Sur le VPS, **sans arrêter ebx** :
   ```bash
   cd /var/www
   git clone --branch cursor/baypilot-dfy-a79f --depth 1 https://github.com/urdirditfurd/mon-site.git baypilot
   cd baypilot/baypilot
   npm install
   cp .env.example .env
   # Recopie tes clés eBay APP (CLIENT_ID / SECRET) depuis ebx/.env — pas le refresh token d’un client
   nano .env
   node operator-server.js
   ```
   Opérateur : `http://IP:3100`

2. Ou script (n’efface pas ebx) :
   ```bash
   sudo BRANCH=cursor/baypilot-dfy-a79f APP_DIR=/var/www/baypilot \
     bash /var/www/baypilot/baypilot/scripts/setup-baypilot-vps.sh
   ```

3. Crée le **premier client = ton propre compte** (dogfood) dans l’UI opérateur.

4. Relance uniquement BayPilot :
   ```bash
   cd /var/www/baypilot/baypilot
   pm2 start ecosystem.config.cjs
   pm2 save
   ```
   Vérifie `pm2 list` : `ebx` est toujours `online`, plus `baypilot-ops` et `baypilot-<id>`.

5. Ouvre le cockpit client (`:3101`) → Paramètres → Connecter eBay **de ce client**. Auto-Publish reste **désarmé** jusqu’à ce que tu coches la case dans l’opérateur.

---

## 2. Cette semaine (offre + 3 prospects)

1. Envoie `offre.html` (ou le lien `/offre.html`) à 10 vendeurs eBay FR que tu connais.
2. Message type :
   > Je pilote déjà un cockpit eBay (tendance → fournisseur → fiche → publish → SAV).  
   > Offre : 1 800 €/mois, je m’occupe des listings et messages. Tu paies le fournisseur, tu gardes la marge.  
   > 3 jours d’essai sur ton compte, OAuth officiel, pas de prélèvement fournisseur auto.
3. Prix : **1 500 €** si < 30 ventes/sem, **1 800 €** standard, **2 500 €** si multi-marchés.
4. Fais signer un mandat (accès eBay vendeur + tu n’achètes pas à sa place sans OK).
5. Objectif : **1 client payant** cette semaine, pas 7.

---

## 3. Onboarding d’un client (45 min)

Dans l’opérateur, coche dans l’ordre :

1. Mandat / CGV signés  
2. OAuth eBay production sur **son** cockpit  
3. `npm run policies:prod` dans **son** `.env` (pas celui d’ebx)  
4. 1 listing publié **à la main** (sniper → Mes Listings → publier), photos ≥ 500 px, net ≥ 5 %  
5. Inbox SAV OK  
6. **Ensuite seulement** : Auto-Publish armé + toggle ON + PM2 `baypilot-<id>` allumé  

Auto-Order = file + adresse. **Le paiement fournisseur reste manuel.**

---

## 4. Semaines 2–6 (les 10K)

| Clients payants | Honoraires | Total |
|---|---|---|
| 3 × 1 800 € | | 5 400 € |
| 6 × 1 800 € | | 10 800 € |

Routine **quotidienne** (30–40 min / client) :

- Sync ventes → préparer commandes → **payer toi-même** chez le fournisseur → Avancer  
- Vider l’inbox questions  
- 5–15 listings si Auto-Publish est armé, sinon sniper manuel  

Routine **hebdo** :

- Ouvrir `/api/clients/<id>/report?format=html`  
- Envoyer le rapport + 3 actions  
- Facturer (virement ou Stripe plus tard)

Ne vends **pas** l’accès logiciel tant que tu n’as pas 5 clients DFY. Le SaaS vient après.

---

## 5. Interdits

- Modifier `/var/www/ebx` ou le process `ebx`
- Brancher un paiement Ali/Amazon 100 % autonome
- Armer Auto-Publish le jour 1 d’un client
- Utiliser le nom / la marque EBX sur l’offre commerciale
- Mélanger deux clients dans le même `BAYPILOT_CLIENT_DIR`

---

## 6. Commandes utiles

```bash
pm2 list
pm2 logs baypilot-ops
pm2 logs baypilot-<id>
pm2 restart baypilot-ops          # OK
pm2 restart ebx                   # NON, sauf maintenance du clone historique
```

Tests locaux :

```bash
cd baypilot
npm test
```
