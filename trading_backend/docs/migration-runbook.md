# Runbook Migrations (Dev / Prod / Rollback)

## 1) Workflow Dev standard

1. Générer une migration:
   - `alembic revision --autogenerate -m "description"`
2. Relire le fichier dans `alembic/versions/`:
   - vérifier `upgrade()` et `downgrade()`
   - vérifier types/index/contraintes attendus
3. Valider localement:
   - `make migrate-check-strict`
4. Appliquer localement:
   - `alembic upgrade head`
5. Vérifier l'application:
   - smoke tests API
   - lecture/écriture DB sur tables impactées

## 2) Workflow release Prod

1. Pré-check CI:
   - `make migrate-check-strict`
   - `pre-commit run --all-files`
2. Backup DB (snapshot)
3. Fenêtre de déploiement validée
4. Dry-run logique:
   - `make migrate-release-dry`
5. Application migration:
   - `make migrate-release`
6. Post-check:
   - healthcheck API
   - endpoint monitoring dashboard
   - vérification logs erreurs DB

## 3) Checklist rollback (incident)

> Objectif: revenir rapidement à une révision stable.

### Déclencheurs typiques
- Erreurs SQL en production après upgrade
- Endpoint critiques indisponibles
- Régression data bloquante

### Étapes opératoires
1. **Stopper le trafic sensible** (maintenance mode / pause workers).
2. **Identifier la dernière révision stable**:
   - `alembic history`
   - `alembic current`
3. **Dry-run rollback**:
   - `make migrate-rollback-dry TARGET=-1`
4. **Rollback réel**:
   - `make migrate-rollback TARGET=-1`
   - ou vers une révision explicite: `TARGET=<revision_id>`
5. **Vérifier état DB**:
   - `alembic current`
6. **Relancer l'application** et exécuter smoke checks.
7. **Documenter l'incident**:
   - cause
   - révision fautive
   - actions correctives

### Règles de sécurité rollback
- Toujours prendre un backup avant migration prod.
- Si migration destructive (drop/alter risqué), prévoir plan de restauration data.
- Ne jamais enchaîner plusieurs downgrades sans validation intermédiaire.
