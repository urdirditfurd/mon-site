#!/usr/bin/env bash
# Crée sur le Bureau Linux un lanceur nommé « video ia »
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
if [[ ! -d "$DESKTOP" ]]; then
  DESKTOP="$HOME/Bureau"
fi
if [[ ! -d "$DESKTOP" ]]; then
  mkdir -p "$HOME/Desktop"
  DESKTOP="$HOME/Desktop"
fi

ICON="$ROOT/assets/video-ia-icon.png"
LAUNCHER="$ROOT/scripts/launch-video-ia.sh"
chmod +x "$LAUNCHER" "$ROOT/scripts/install-desktop-shortcut.sh"

DEST="$DESKTOP/video ia.desktop"
cat > "$DEST" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=video ia
Comment=Suivi pipeline Contes — Pinokio Wan + Conte Factory
Exec=$LAUNCHER
Path=$ROOT
Icon=$ICON
Terminal=true
Categories=AudioVideo;Development;
EOF
chmod +x "$DEST"

# Marquer comme autorisé (GNOME)
if command -v gio >/dev/null 2>&1; then
  gio set "$DEST" metadata::trusted true 2>/dev/null || true
fi

echo "OK — raccourci créé : $DEST"
