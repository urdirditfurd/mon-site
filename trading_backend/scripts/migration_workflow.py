"""Workflow standardisé migrations dev/prod.

Commandes:
- check: validation locale des migrations
- release: pipeline de release migration (check + optional upgrade)
- rollback: exécution d'un downgrade contrôlé
"""

from __future__ import annotations

import argparse
import ast
import compileall
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = ROOT_DIR / "alembic.ini"
VERSIONS_DIR = ROOT_DIR / "alembic" / "versions"


@dataclass(slots=True)
class RevisionNode:
    """Métadonnées extraites d'un fichier de migration."""

    path: Path
    revision: str | None
    down_revisions: list[str]
    has_upgrade_body: bool
    has_downgrade_body: bool


def _extract_revisions(path: Path) -> RevisionNode:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)

    revision: str | None = None
    down_revisions: list[str] = []
    has_upgrade_body = False
    has_downgrade_body = False

    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "revision":
                    if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                        revision = node.value.value
                if isinstance(target, ast.Name) and target.id == "down_revision":
                    down_revisions = _parse_down_revision(node.value)

        if isinstance(node, ast.FunctionDef) and node.name in {"upgrade", "downgrade"}:
            body_is_not_pass = any(not isinstance(statement, ast.Pass) for statement in node.body)
            if node.name == "upgrade":
                has_upgrade_body = body_is_not_pass
            else:
                has_downgrade_body = body_is_not_pass

    return RevisionNode(
        path=path,
        revision=revision,
        down_revisions=down_revisions,
        has_upgrade_body=has_upgrade_body,
        has_downgrade_body=has_downgrade_body,
    )


def _parse_down_revision(value: ast.AST) -> list[str]:
    if isinstance(value, ast.Constant):
        if value.value is None:
            return []
        if isinstance(value.value, str):
            return [value.value]
    if isinstance(value, (ast.Tuple, ast.List)):
        refs: list[str] = []
        for item in value.elts:
            if isinstance(item, ast.Constant) and isinstance(item.value, str):
                refs.append(item.value)
        return refs
    return []


def _load_nodes() -> list[RevisionNode]:
    files = sorted(path for path in VERSIONS_DIR.glob("*.py") if path.name != "__init__.py")
    return [_extract_revisions(path) for path in files]


def _run_compile_check() -> bool:
    print("• Vérification syntaxe Python (app + alembic)")
    ok = compileall.compile_dir(str(ROOT_DIR / "app"), quiet=1) and compileall.compile_dir(
        str(ROOT_DIR / "alembic"),
        quiet=1,
    )
    return bool(ok)


def check_migrations(strict: bool = False) -> int:
    """Valide la cohérence du graphe Alembic."""

    print("=== Migration check ===")
    issues: list[str] = []

    if not _run_compile_check():
        issues.append("Compilation Python échouée.")

    nodes = _load_nodes()
    if not nodes:
        issues.append("Aucune migration trouvée dans alembic/versions.")
    else:
        revisions = [node.revision for node in nodes]
        if any(rev is None for rev in revisions):
            issues.append("Un ou plusieurs fichiers ne déclarent pas `revision`.")

        revision_set = {rev for rev in revisions if rev}
        down_refs = {ref for node in nodes for ref in node.down_revisions}
        unknown_refs = sorted(ref for ref in down_refs if ref not in revision_set)
        if unknown_refs:
            issues.append(f"down_revision introuvable(s): {', '.join(unknown_refs)}")

        head_candidates = sorted(revision_set - down_refs)
        print(f"• Migrations détectées: {len(nodes)}")
        print(f"• Heads détectés: {', '.join(head_candidates) if head_candidates else 'aucun'}")

        if strict and len(head_candidates) != 1:
            issues.append(
                "Le graphe doit avoir exactement 1 head en mode strict "
                f"(actuel: {len(head_candidates)})."
            )

        for node in nodes:
            if not node.has_upgrade_body:
                issues.append(f"{node.path.name}: fonction upgrade vide.")
            if not node.has_downgrade_body:
                issues.append(f"{node.path.name}: fonction downgrade vide.")

    if issues:
        print("✗ ÉCHEC")
        for issue in issues:
            print(f"  - {issue}")
        return 1

    print("✓ OK: migrations cohérentes")
    return 0


def _run_alembic(command: list[str], database_url: str | None = None) -> int:
    env = os.environ.copy()
    if database_url:
        env["DATABASE_URL"] = database_url
    full_cmd = ["alembic", "-c", str(ALEMBIC_INI), *command]
    print(f"• Exécution: {' '.join(full_cmd)}")
    try:
        subprocess.run(full_cmd, check=True, cwd=str(ROOT_DIR), env=env)
    except FileNotFoundError:
        print("✗ alembic introuvable. Installe les dépendances: pip install -r requirements.txt")
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"✗ commande échouée (exit={exc.returncode})")
        return exc.returncode
    return 0


def release_migrations(apply: bool, database_url: str | None) -> int:
    """Pipeline standard release migrations."""

    print("=== Release migration workflow ===")
    check_code = check_migrations(strict=True)
    if check_code != 0:
        return check_code

    if not apply:
        print("✓ Dry-run terminé. Pour appliquer: --apply")
        return 0

    return _run_alembic(["upgrade", "head"], database_url=database_url)


def rollback_migrations(target: str, apply: bool, database_url: str | None) -> int:
    """Workflow contrôlé de rollback."""

    print("=== Rollback migration workflow ===")
    check_code = check_migrations(strict=False)
    if check_code != 0:
        return check_code

    if not apply:
        print(f"✓ Dry-run rollback vers {target}. Pour appliquer: --apply")
        return 0

    return _run_alembic(["downgrade", target], database_url=database_url)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Workflow migrations Alembic")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check_parser = subparsers.add_parser("check", help="Valide la cohérence des migrations")
    check_parser.add_argument("--strict", action="store_true", help="Exige exactement un head")

    release_parser = subparsers.add_parser("release", help="Pipeline release migrations")
    release_parser.add_argument("--apply", action="store_true", help="Applique upgrade head")
    release_parser.add_argument("--database-url", help="Surcharge DATABASE_URL")

    rollback_parser = subparsers.add_parser("rollback", help="Workflow rollback contrôlé")
    rollback_parser.add_argument("--target", default="-1", help="Cible downgrade (default: -1)")
    rollback_parser.add_argument("--apply", action="store_true", help="Applique downgrade")
    rollback_parser.add_argument("--database-url", help="Surcharge DATABASE_URL")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "check":
        return check_migrations(strict=args.strict)
    if args.command == "release":
        return release_migrations(apply=args.apply, database_url=args.database_url)
    if args.command == "rollback":
        return rollback_migrations(target=args.target, apply=args.apply, database_url=args.database_url)

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
