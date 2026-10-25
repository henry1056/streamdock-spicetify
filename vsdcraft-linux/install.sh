#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "      ⚡ Installing VSDCraft Linux (Stream Dock N3)        "
echo "=========================================================="

# 1. Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 is not installed. Please install Python 3.10+."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 2. Setup Python Virtual Environment and Install Dependencies
echo "📦 Setting up Python environment..."
VENV_DIR="${SCRIPT_DIR}/.venv"
if [ ! -d "${VENV_DIR}" ]; then
    echo "Creating virtual environment at ${VENV_DIR}..."
    python3 -m venv "${VENV_DIR}" 2>/dev/null || true
fi

if [ -f "${VENV_DIR}/bin/pip" ]; then
    "${VENV_DIR}/bin/pip" install --upgrade pip
    "${VENV_DIR}/bin/pip" install -r "${SCRIPT_DIR}/requirements.txt"
    PYTHON_EXEC="${VENV_DIR}/bin/python3"
else
    # Fallback to user pip or break-system-packages
    python3 -m pip install --user -r "${SCRIPT_DIR}/requirements.txt" 2>/dev/null || \
    python3 -m pip install --break-system-packages -r "${SCRIPT_DIR}/requirements.txt"
    PYTHON_EXEC="$(command -v python3)"
fi

# 3. Setup Udev Permissions (Allows non-root access to Stream Dock HID)
echo "🔒 Installing udev rules for Stream Dock USB access..."
if [ -f "${SCRIPT_DIR}/99-streamdock.rules" ]; then
    sudo cp "${SCRIPT_DIR}/99-streamdock.rules" /etc/udev/rules.d/99-streamdock.rules
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    echo "✅ Udev rules active! (If your device is already plugged in, unplug & re-plug it)"
fi

# 4. Install Desktop Application Shortcut
echo "🖥️ Installing Desktop shortcut..."
DESKTOP_DIR="${HOME}/.local/share/applications"
mkdir -p "${DESKTOP_DIR}"
cat <<EOF > "${DESKTOP_DIR}/vsdcraft.desktop"
[Desktop Entry]
Name=VSDCraft Linux
Comment=Stream Dock N3 Controller
Exec=${PYTHON_EXEC} -m vsdcraft
Path=${SCRIPT_DIR}
Icon=input-gaming
Terminal=false
Type=Application
Categories=Utility;AudioVideo;
EOF
chmod +x "${DESKTOP_DIR}/vsdcraft.desktop"

# 5. Generate Systemd Service File
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
mkdir -p "${SYSTEMD_USER_DIR}"
cat <<EOF > "${SYSTEMD_USER_DIR}/vsdcraft.service"
[Unit]
Description=VSDCraft Stream Dock N3 Background Daemon
After=graphical-session.target pipewire.service pulseaudio.service

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${PYTHON_EXEC} -m vsdcraft --daemon
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
echo ""
echo "🚀 Installation completed successfully!"
echo ""
echo "To start the VSDCraft GUI:"
echo "    cd ${SCRIPT_DIR} && python3 -m vsdcraft"
echo ""
echo "To run in simulation mode without hardware:"
echo "    python3 -m vsdcraft --mock"
echo ""
echo "To enable background auto-start on boot (systemd service):"
echo "    mkdir -p ~/.config/systemd/user/"
echo "    cp ${SCRIPT_DIR}/vsdcraft.service ~/.config/systemd/user/"
echo "    systemctl --user daemon-reload"
echo "    systemctl --user enable --now vsdcraft.service"
echo "=========================================================="
