"""
Bloque torchaudio et xformers AVANT tout chargement de .pyd.
Copié dans le site-packages du venv ComfyUI par le preflight.
Un import lève ImportError (sans charger la DLL) — ComfyUI gère déjà ce cas.
"""

from __future__ import annotations

import sys
import types
from importlib.abc import Loader, MetaPathFinder
from importlib.machinery import ModuleSpec

_BLOCKED = frozenset({"torchaudio", "xformers"})


class _FailLoader(Loader):
    def create_module(self, spec: ModuleSpec) -> types.ModuleType | None:
        raise ImportError(f"{spec.name} disabled by LTX Studio (ARM x64 emulation)")

    def exec_module(self, module: types.ModuleType) -> None:
        raise ImportError("disabled by LTX Studio")


class _BlockNativeExtFinder(MetaPathFinder):
    def find_spec(
        self,
        fullname: str,
        path: object | None = None,
        target: types.ModuleType | None = None,
    ) -> ModuleSpec | None:
        root = fullname.split(".", 1)[0]
        if root not in _BLOCKED:
            return None
        return ModuleSpec(fullname, _FailLoader(), is_package=True, origin="ltx-stub")


def _install() -> None:
    for existing in list(sys.meta_path):
        if type(existing).__name__ == "_BlockNativeExtFinder":
            return
    sys.meta_path.insert(0, _BlockNativeExtFinder())


_install()
