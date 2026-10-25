#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "    🎵 Spicetify + Stream Dock N3 Linux Setup Script      "
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPICETIFY_EXT_SRC="${SCRIPT_DIR}/spicetify-extension/streamdock.js"
PLUGIN_SRC="${SCRIPT_DIR}/streamdock-plugin/com.vsdinside.spicetify.sdPlugin"
VSDCRAFT_DIR="${SCRIPT_DIR}/vsdcraft-linux"

# ---------------------------------------------------------
# Step 1: Detect Spicetify and Install streamdock.js
# ---------------------------------------------------------
echo ""
echo "Step 1: Installing Spicetify Extension..."

SPICETIFY_EXT_DIR="${HOME}/.config/spicetify/Extensions"
FLATPAK_EXT_DIR="${HOME}/.var/app/com.spotify.Client/config/spicetify/Extensions"

TARGET_DIR="${SPICETIFY_EXT_DIR}"
if [ -d "${FLATPAK_EXT_DIR}" ] && [ ! -d "${SPICETIFY_EXT_DIR}" ]; then
    TARGET_DIR="${FLATPAK_EXT_DIR}"
fi

mkdir -p "${TARGET_DIR}"
cp -f "${SPICETIFY_EXT_SRC}" "${TARGET_DIR}/streamdock.js"
echo "✅ Copied streamdock.js to: ${TARGET_DIR}/streamdock.js"

# Enable & Apply via spicetify CLI if installed
if command -v spicetify &> /dev/null; then
    echo "⚙️  Configuring Spicetify with streamdock.js..."
    spicetify config extensions streamdock.js || true
    echo "🚀 Applying Spicetify patch..."
    spicetify apply || true
    echo "✅ Spicetify extension registered and applied!"
else
    echo "ℹ️  'spicetify' CLI not found in PATH."
    echo "    If you haven't installed Spicetify yet, install it via:"
    echo "    curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh | sh"
    echo "    Then run: spicetify config extensions streamdock.js && spicetify apply"
fi

# ---------------------------------------------------------
# Step 2: Deploy StreamDock Plugin Bundle for VSDCraft
# ---------------------------------------------------------
echo ""
echo "Step 2: Deploying StreamDock Plugin Bundle..."
PLUGIN_DEST_DIR="${HOME}/.config/vsdcraft/plugins"
mkdir -p "${PLUGIN_DEST_DIR}"
rm -rf "${PLUGIN_DEST_DIR}/com.vsdinside.spicetify.sdPlugin"
cp -r "${PLUGIN_SRC}" "${PLUGIN_DEST_DIR}/com.vsdinside.spicetify.sdPlugin"
echo "✅ Installed plugin bundle to: ${PLUGIN_DEST_DIR}/com.vsdinside.spicetify.sdPlugin"

# ---------------------------------------------------------
# Step 3: Install VSDCraft Controller & Udev Rules
# ---------------------------------------------------------
echo ""
echo "Step 3: Installing VSDCraft Linux Controller & USB Permissions..."
if [ -f "${VSDCRAFT_DIR}/install.sh" ]; then
    bash "${VSDCRAFT_DIR}/install.sh"
else
    echo "⚠️  vsdcraft-linux/install.sh not found."
fi

# ---------------------------------------------------------
# Completion
# ---------------------------------------------------------
echo ""
echo "=========================================================="
echo "🎉 Linux Installation Completed!"
echo "=========================================================="
echo "Next Steps:"
echo " 1. Make sure Spotify desktop is running (with Spicetify applied)."
echo " 2. Launch VSDCraft controller:"
echo "    cd ${VSDCRAFT_DIR} && .venv/bin/python3 -m vsdcraft"
echo "    (Or find 'VSDCraft Linux' in your desktop application menu)"
echo ""
echo " 3. To run in background as a user service on system boot:"
echo "    systemctl --user daemon-reload"
echo "    systemctl --user enable --now vsdcraft.service"
echo "=========================================================="
