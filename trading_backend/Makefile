PYTHON ?= python
MIGRATION_WORKFLOW := $(PYTHON) scripts/migration_workflow.py

.PHONY: migrate-check migrate-check-strict migrate-release-dry migrate-release migrate-rollback-dry migrate-rollback precommit-install precommit-run

migrate-check:
	$(MIGRATION_WORKFLOW) check

migrate-check-strict:
	$(MIGRATION_WORKFLOW) check --strict

migrate-release-dry:
	$(MIGRATION_WORKFLOW) release

migrate-release:
	$(MIGRATION_WORKFLOW) release --apply

migrate-rollback-dry:
	$(MIGRATION_WORKFLOW) rollback --target=$${TARGET:--1}

migrate-rollback:
	$(MIGRATION_WORKFLOW) rollback --target=$${TARGET:--1} --apply

precommit-install:
	pre-commit install

precommit-run:
	pre-commit run --all-files

test-install:
	$(PYTHON) -m pip install -r requirements-dev.txt

test:
	$(PYTHON) -m pytest
