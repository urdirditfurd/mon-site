#!/usr/bin/env python3
"""
Tower Watchdog — surveille la tour Pinokio via Tailscale depuis le VPS OVH.

Sans onduleur, ce script est le gardien principal :
  1. Ping Tailscale → la tour est-elle allumée ?
  2. HTTP health → Pinokio Remote répond-il ?
  3. SSH restart → tentative douce de relance
  4. Smart plug → hard reset électrique si Windows est gelé
"""
from __future__ import annotations

import json
import logging
import platform
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
LOG_FORMAT = "%(asctime)s  %(levelname)-8s  %(message)s"

log = logging.getLogger("tower-watchdog")


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        log.error("config.json introuvable. Copiez config.example.json → config.json")
        sys.exit(1)
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class WatchdogState:
    ping_fail_streak: int = 0
    service_fail_streak: int = 0
    last_reset_at: float = 0.0
    resets_today: int = 0
    resets_day: str = ""
    last_notification: str = ""

    @classmethod
    def load(cls, path: Path) -> WatchdogState:
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return cls(**{k: data[k] for k in cls.__dataclass_fields__ if k in data})
        except (json.JSONDecodeError, TypeError, KeyError):
            log.warning("État corrompu, réinitialisation.")
            return cls()

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.__dict__, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )


def ping_host(ip: str, timeout_sec: int = 2) -> bool:
    system = platform.system().lower()
    if system == "windows":
        cmd = ["ping", "-n", "2", "-w", str(timeout_sec * 1000), ip]
    else:
        cmd = ["ping", "-c", "2", "-W", str(timeout_sec), ip]
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0


def http_ok(url: str, timeout: int) -> bool:
    if not url:
        return True
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 500
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def notify(cfg: dict[str, Any], message: str, state: WatchdogState) -> None:
    log.info("NOTIF: %s", message)
    notif = cfg.get("notifications", {})
    discord_url = notif.get("discord_webhook", "").strip()
    if discord_url:
        payload = json.dumps({"content": message}).encode("utf-8")
        req = urllib.request.Request(
            discord_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=10)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            log.warning("Discord webhook échoué: %s", exc)

    tg_token = notif.get("telegram_bot_token", "").strip()
    tg_chat = notif.get("telegram_chat_id", "").strip()
    if tg_token and tg_chat:
        tg_url = f"https://api.telegram.org/bot{tg_token}/sendMessage"
        payload = json.dumps({"chat_id": tg_chat, "text": message}).encode("utf-8")
        req = urllib.request.Request(
            tg_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=10)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            log.warning("Telegram échoué: %s", exc)

    state.last_notification = message


def ssh_restart(cfg: dict[str, Any]) -> bool:
    ssh_cfg = cfg.get("ssh_restart", {})
    if not ssh_cfg.get("enabled", False):
        return False
    command = ssh_cfg.get("command", "").strip()
    if not command:
        return False
    timeout = int(ssh_cfg.get("timeout_seconds", 30))
    log.info("Tentative SSH restart: %s", command)
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode == 0:
            log.info("SSH restart OK")
            return True
        log.warning("SSH restart échoué (code %s): %s", result.returncode, result.stderr.strip())
    except subprocess.TimeoutExpired:
        log.warning("SSH restart timeout (%ss)", timeout)
    except OSError as exc:
        log.warning("SSH restart erreur: %s", exc)
    return False


def shelly_set_state(ip: str, on: bool) -> None:
    url = f"http://{ip}/relay/0?turn={'on' if on else 'off'}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"Shelly HTTP {resp.status}")


def http_generic_plug(cfg: dict[str, Any], on: bool) -> None:
    plug = cfg["smart_plug"]
    url = plug["http_on_url"] if on else plug["http_off_url"]
    method = plug.get("http_method", "POST").upper()
    headers = plug.get("http_headers", {})
    data = None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"Smart plug HTTP {resp.status}")


def smart_plug_set(cfg: dict[str, Any], on: bool) -> None:
    plug = cfg.get("smart_plug", {})
    provider = plug.get("provider", "http_generic")

    if provider == "shelly":
        shelly_set_state(plug["shelly_ip"], on)
        return

    if provider == "tuya":
        try:
            import tinytuya  # type: ignore[import-untyped]
        except ImportError as exc:
            raise RuntimeError("pip install tinytuya requis pour provider tuya") from exc
        device = tinytuya.OutletDevice(
            plug["tuya_device_id"],
            plug["tuya_ip"],
            plug["tuya_local_key"],
        )
        device.set_status(on, switch=1)
        return

    http_generic_plug(cfg, on)


def can_hard_reset(cfg: dict[str, Any], state: WatchdogState) -> bool:
    plug = cfg.get("smart_plug", {})
    if not plug.get("enabled", False):
        return False

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if state.resets_day != today:
        state.resets_day = today
        state.resets_today = 0

    max_per_day = int(plug.get("max_resets_per_day", 6))
    if state.resets_today >= max_per_day:
        log.warning("Limite quotidienne de hard reset atteinte (%s)", max_per_day)
        return False

    cooldown = int(plug.get("cooldown_seconds", 600))
    elapsed = time.time() - state.last_reset_at
    if state.last_reset_at and elapsed < cooldown:
        log.warning("Cooldown actif (%ss restants)", int(cooldown - elapsed))
        return False

    return True


def hard_reset(cfg: dict[str, Any], state: WatchdogState, reason: str) -> None:
    plug = cfg["smart_plug"]
    off_seconds = int(plug.get("off_seconds", 15))

    notify(cfg, f"⚡ HARD RESET prise connectée — {reason}", state)
    log.warning("Hard reset: OFF pendant %ss", off_seconds)

    smart_plug_set(cfg, on=False)
    time.sleep(off_seconds)
    smart_plug_set(cfg, on=True)

    state.last_reset_at = time.time()
    state.resets_today += 1
    state.ping_fail_streak = 0
    state.service_fail_streak = 0
    notify(cfg, f"✅ Prise reconnectée. Attente boot (~{cfg['tower'].get('boot_wait_seconds', 300)}s).", state)


def service_healthy(cfg: dict[str, Any]) -> bool:
    checks = cfg["checks"]
    timeout = int(checks.get("http_timeout_seconds", 8))
    remote_ok = http_ok(checks.get("pinokio_remote_url", ""), timeout)
    ui_ok = http_ok(checks.get("pinokio_ui_url", ""), timeout)

    remote_url = checks.get("pinokio_remote_url", "")
    ui_url = checks.get("pinokio_ui_url", "")

    if remote_url and ui_url:
        return remote_ok or ui_ok
    if remote_url:
        return remote_ok
    if ui_url:
        return ui_ok
    return True


def run_once(cfg: dict[str, Any], state: WatchdogState) -> None:
    tower = cfg["tower"]
    checks = cfg["checks"]
    ip = tower["tailscale_ip"]
    ping_threshold = int(tower.get("ping_failures_before_alert", 3))
    service_threshold = int(checks.get("service_failures_before_restart", 3))

    if ping_host(ip):
        if state.ping_fail_streak > 0:
            notify(cfg, f"🟢 Tour de retour en ligne ({ip})", state)
        state.ping_fail_streak = 0

        if service_healthy(cfg):
            state.service_fail_streak = 0
            log.debug("OK — ping + services")
            return

        state.service_fail_streak += 1
        log.warning(
            "Service down (streak %s/%s)",
            state.service_fail_streak,
            service_threshold,
        )

        if state.service_fail_streak < service_threshold:
            return

        notify(cfg, "🟡 Tour allumée mais Pinokio ne répond pas. Tentative SSH…", state)
        if ssh_restart(cfg):
            state.service_fail_streak = 0
            time.sleep(30)
            if service_healthy(cfg):
                notify(cfg, "✅ Pinokio relancé via SSH.", state)
                return

        if can_hard_reset(cfg, state):
            hard_reset(cfg, state, "Pinokio injoignable après échec SSH")
        else:
            notify(cfg, "🔴 Pinokio down — hard reset bloqué (cooldown/limite).", state)
        return

    state.ping_fail_streak += 1
    log.warning("Ping KO (%s/%s)", state.ping_fail_streak, ping_threshold)

    if state.ping_fail_streak < ping_threshold:
        return

    boot_wait = int(tower.get("boot_wait_seconds", 300))
    notify(
        cfg,
        f"🔴 Tour injoignable ({ip}). Coupure de courant probable. "
        f"Si le courant revient, boot auto dans ~{boot_wait}s (BIOS Power On).",
        state,
    )

    if state.ping_fail_streak == ping_threshold and can_hard_reset(cfg, state):
        elapsed_since_reset = time.time() - state.last_reset_at
        if state.last_reset_at and elapsed_since_reset < boot_wait:
            log.info("Attente boot naturel après dernier reset…")
            return
        if state.ping_fail_streak >= ping_threshold + 2 and can_hard_reset(cfg, state):
            hard_reset(cfg, state, "Tour injoignable — tentative de réveil électrique")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt="%H:%M:%S")
    cfg = load_config()
    state_path = Path(cfg.get("state_file", "/var/lib/tower-watchdog/state.json"))
    state = WatchdogState.load(state_path)
    interval = int(cfg.get("checks", {}).get("interval_seconds", 60))

    log.info("Tower Watchdog démarré — cible %s — intervalle %ss", cfg["tower"]["tailscale_ip"], interval)
    notify(cfg, f"🚀 Watchdog démarré — surveillance {cfg['tower']['tailscale_ip']}", state)
    state.save(state_path)

    while True:
        try:
            run_once(cfg, state)
            state.save(state_path)
        except KeyboardInterrupt:
            log.info("Arrêt demandé.")
            break
        except Exception:
            log.exception("Erreur inattendue dans la boucle watchdog")
        time.sleep(interval)


if __name__ == "__main__":
    main()
