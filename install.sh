#!/usr/bin/env bash
set -euo pipefail

UUID="claude-code-limits@kkulebaev"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "Installing extension to: ${DEST_DIR}"
mkdir -p "${DEST_DIR}/schemas"

cp -f "${SRC_DIR}/metadata.json"   "${DEST_DIR}/metadata.json"
cp -f "${SRC_DIR}/extension.js"    "${DEST_DIR}/extension.js"
cp -f "${SRC_DIR}/prefs.js"        "${DEST_DIR}/prefs.js"
cp -f "${SRC_DIR}/stylesheet.css"  "${DEST_DIR}/stylesheet.css"
cp -f "${SRC_DIR}/schemas/"*.gschema.xml "${DEST_DIR}/schemas/"

echo "Compiling GSettings schemas..."
glib-compile-schemas "${DEST_DIR}/schemas/"

echo
echo "Done. Next steps:"
echo "  1. Logout/login (Wayland) — required for shell to reload extension code."
echo "  2. Verify:"
echo "       gnome-extensions info ${UUID}"
echo "  3. Open preferences:"
echo "       gnome-extensions prefs ${UUID}"
echo
echo "Uninstall:"
echo "  gnome-extensions disable ${UUID} && rm -rf '${DEST_DIR}'"
