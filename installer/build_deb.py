#!/usr/bin/env python3
"""
Python script to build a native Debian (.deb) package without external dependencies.
Produces dist/streamdock-spicetify_1.0.0_all.deb
"""

import os
import io
import time
import tarfile
import gzip
import shutil

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DIST_DIR = os.path.join(ROOT_DIR, "dist")
os.makedirs(DIST_DIR, exist_ok=True)

DEB_NAME = "streamdock-spicetify_1.0.0_all.deb"
OUTPUT_DEB = os.path.join(DIST_DIR, DEB_NAME)

def make_ar_header(name: str, size: int, mode: int = 0o100644, mtime: int = None) -> bytes:
    if mtime is None:
        mtime = int(time.time())
    header = bytearray(60)
    # File identifier (16 bytes, space padded, format: name + '/')
    name_field = (name.strip() + "/").ljust(16)[:16].encode("ascii")
    header[0:16] = name_field
    # mtime (12 bytes)
    header[16:28] = str(mtime).ljust(12)[:12].encode("ascii")
    # uid (6 bytes)
    header[28:34] = b"0     "
    # gid (6 bytes)
    header[34:40] = b"0     "
    # mode (8 bytes, octal)
    header[40:48] = oct(mode).ljust(8)[:8].encode("ascii")
    # size (10 bytes)
    header[48:58] = str(size).ljust(10)[:10].encode("ascii")
    # magic end (2 bytes: `\n)
    header[58:60] = b"\x60\x0a"
    return bytes(header)

def create_deb():
    print(f"Creating Debian package: {OUTPUT_DEB}...")

    # 1. debian-binary
    debian_binary_bytes = b"2.0\n"

    # 2. control.tar.gz
    control_text = """Package: streamdock-spicetify
Version: 1.0.0
Section: sound
Priority: optional
Architecture: all
Maintainer: henry1056 <henry1056@users.noreply.github.com>
Depends: python3 (>= 3.10), python3-pip, python3-pil, python3-websockets, python3-psutil
Recommends: spotify-client, playerctl, libhidapi-hidraw0
Homepage: https://github.com/henry1056/streamdock-spicetify
Description: Stream Dock N3 Spotify Controller & Spicetify Integration
 Control Spotify desktop directly from your VSDinside Stream Dock N3 macro pad.
 Features instant local play/pause, rotary knob volume control, live LCD album art,
 playlist caching, background daemon, and full Linux support.
"""

    postinst_text = """#!/bin/sh
set -e

# Reload udev rules for Stream Dock USB HID access
if [ -x /usr/bin/udevadm ]; then
    udevadm control --reload-rules || true
    udevadm trigger || true
fi

# Attempt to install customtkinter / hidapi if missing
python3 -m pip install --break-system-packages customtkinter hidapi 2>/dev/null || true

# Check if spicetify is in PATH and offer auto-setup
if command -v spicetify >/dev/null 2>&1; then
    echo "=========================================================="
    echo "  Spicetify detected! To complete Spicetify integration:  "
    echo "  Run: streamdock-spicetify-setup                         "
    echo "=========================================================="
fi

exit 0
"""

    prerm_text = """#!/bin/sh
set -e
exit 0
"""

    control_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=control_buf, mode="wb", mtime=int(time.time())) as gz:
        with tarfile.open(fileobj=gz, mode="w") as tar:
            for name, content, mode in [
                ("./control", control_text.encode("utf-8"), 0o644),
                ("./postinst", postinst_text.encode("utf-8"), 0o755),
                ("./prerm", prerm_text.encode("utf-8"), 0o755)
            ]:
                ti = tarfile.TarInfo(name)
                ti.size = len(content)
                ti.mtime = int(time.time())
                ti.mode = mode
                ti.uname = "root"
                ti.gname = "root"
                tar.addfile(ti, io.BytesIO(content))

    control_tar_gz = control_buf.getvalue()

    # 3. data.tar.gz
    data_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=data_buf, mode="wb", mtime=int(time.time())) as gz:
        with tarfile.open(fileobj=gz, mode="w") as tar:
            # Helper to add directory recursively
            def add_dir_to_tar(local_dir, archive_dir):
                for root, dirs, files in os.walk(local_dir):
                    rel = os.path.relpath(root, local_dir)
                    dest_dir = os.path.normpath(os.path.join(archive_dir, rel)).replace("\\", "/")
                    if dest_dir != archive_dir:
                        dinfo = tarfile.TarInfo(dest_dir)
                        dinfo.type = tarfile.DIRTYPE
                        dinfo.mode = 0o755
                        dinfo.mtime = int(time.time())
                        tar.addfile(dinfo)

                    for f in files:
                        if f.endswith((".pyc", ".log", ".tmp")):
                            continue
                        if "__pycache__" in root:
                            continue
                        fpath = os.path.join(root, f)
                        dest_path = os.path.normpath(os.path.join(dest_dir, f)).replace("\\", "/")
                        ti = tarfile.TarInfo(dest_path)
                        ti.size = os.path.getsize(fpath)
                        ti.mtime = int(os.path.getmtime(fpath))
                        ti.mode = 0o755 if fpath.endswith((".sh", ".desktop")) else 0o644
                        with open(fpath, "rb") as fp:
                            tar.addfile(ti, fp)

            # Filesystem folders:
            # /usr/share/vsdcraft/...
            vsdcraft_src = os.path.join(ROOT_DIR, "vsdcraft-linux", "vsdcraft")
            add_dir_to_tar(vsdcraft_src, "./usr/share/vsdcraft/vsdcraft")

            # Plugin bundle: /usr/share/vsdcraft/plugins/com.vsdinside.spicetify.sdPlugin
            plugin_src = os.path.join(ROOT_DIR, "streamdock-plugin", "com.vsdinside.spicetify.sdPlugin")
            add_dir_to_tar(plugin_src, "./usr/share/vsdcraft/plugins/com.vsdinside.spicetify.sdPlugin")

            # Spicetify extension source: /usr/share/vsdcraft/spicetify-extension/streamdock.js
            ext_file = os.path.join(ROOT_DIR, "spicetify-extension", "streamdock.js")
            ti = tarfile.TarInfo("./usr/share/vsdcraft/spicetify-extension/streamdock.js")
            ti.size = os.path.getsize(ext_file)
            ti.mode = 0o644
            ti.mtime = int(os.path.getmtime(ext_file))
            with open(ext_file, "rb") as fp:
                tar.addfile(ti, fp)

            # /usr/bin/vsdcraft launcher
            vsdcraft_bin = """#!/bin/sh
export PYTHONPATH="/usr/share/vsdcraft:${PYTHONPATH}"
exec /usr/bin/python3 -m vsdcraft "$@"
"""
            ti = tarfile.TarInfo("./usr/bin/vsdcraft")
            b_content = vsdcraft_bin.encode("utf-8")
            ti.size = len(b_content)
            ti.mode = 0o755
            ti.mtime = int(time.time())
            tar.addfile(ti, io.BytesIO(b_content))

            # /usr/bin/streamdock-spicetify-setup
            setup_bin = """#!/bin/sh
set -e
echo "=========================================================="
echo "    Stream Dock N3 - Spicetify User Setup                "
echo "=========================================================="

EXT_SRC="/usr/share/vsdcraft/spicetify-extension/streamdock.js"
TARGET_DIR="${HOME}/.config/spicetify/Extensions"
mkdir -p "${TARGET_DIR}"
cp -f "${EXT_SRC}" "${TARGET_DIR}/streamdock.js"
echo "Copied streamdock.js to ${TARGET_DIR}/streamdock.js"

PLUGIN_SRC="/usr/share/vsdcraft/plugins/com.vsdinside.spicetify.sdPlugin"
USER_PLUGIN_DIR="${HOME}/.config/vsdcraft/plugins"
mkdir -p "${USER_PLUGIN_DIR}"
cp -rf "${PLUGIN_SRC}" "${USER_PLUGIN_DIR}/"
echo "Deployed StreamDock plugin to ${USER_PLUGIN_DIR}/"

if command -v spicetify >/dev/null 2>&1; then
    spicetify config extensions streamdock.js || true
    spicetify apply || true
    echo "Spicetify extension registered and applied!"
fi
echo "Setup complete! Launch VSDCraft by running: vsdcraft"
"""
            ti = tarfile.TarInfo("./usr/bin/streamdock-spicetify-setup")
            s_content = setup_bin.encode("utf-8")
            ti.size = len(s_content)
            ti.mode = 0o755
            ti.mtime = int(time.time())
            tar.addfile(ti, io.BytesIO(s_content))

            # /lib/udev/rules.d/99-streamdock.rules
            udev_file = os.path.join(ROOT_DIR, "vsdcraft-linux", "99-streamdock.rules")
            ti = tarfile.TarInfo("./lib/udev/rules.d/99-streamdock.rules")
            ti.size = os.path.getsize(udev_file)
            ti.mode = 0o644
            ti.mtime = int(os.path.getmtime(udev_file))
            with open(udev_file, "rb") as fp:
                tar.addfile(ti, fp)

            # /usr/share/applications/vsdcraft.desktop
            desktop_content = """[Desktop Entry]
Name=VSDCraft Linux
Comment=Stream Dock N3 Controller
Exec=/usr/bin/vsdcraft
Icon=input-gaming
Terminal=false
Type=Application
Categories=Utility;AudioVideo;
"""
            ti = tarfile.TarInfo("./usr/share/applications/vsdcraft.desktop")
            d_bytes = desktop_content.encode("utf-8")
            ti.size = len(d_bytes)
            ti.mode = 0o644
            ti.mtime = int(time.time())
            tar.addfile(ti, io.BytesIO(d_bytes))

            # /usr/lib/systemd/user/vsdcraft.service
            service_content = """[Unit]
Description=VSDCraft Stream Dock N3 Background Daemon
After=graphical-session.target pipewire.service pulseaudio.service

[Service]
Type=simple
ExecStart=/usr/bin/vsdcraft --daemon
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
"""
            ti = tarfile.TarInfo("./usr/lib/systemd/user/vsdcraft.service")
            srv_bytes = service_content.encode("utf-8")
            ti.size = len(srv_bytes)
            ti.mode = 0o644
            ti.mtime = int(time.time())
            tar.addfile(ti, io.BytesIO(srv_bytes))

    data_tar_gz = data_buf.getvalue()

    # 4. Assemble standard AR archive
    with open(OUTPUT_DEB, "wb") as f:
        # AR magic
        f.write(b"!<arch>\n")

        # 1: debian-binary
        f.write(make_ar_header("debian-binary", len(debian_binary_bytes)))
        f.write(debian_binary_bytes)
        if len(debian_binary_bytes) % 2 != 0:
            f.write(b"\n")

        # 2: control.tar.gz
        f.write(make_ar_header("control.tar.gz", len(control_tar_gz)))
        f.write(control_tar_gz)
        if len(control_tar_gz) % 2 != 0:
            f.write(b"\n")

        # 3: data.tar.gz
        f.write(make_ar_header("data.tar.gz", len(data_tar_gz)))
        f.write(data_tar_gz)
        if len(data_tar_gz) % 2 != 0:
            f.write(b"\n")

    size_mb = os.path.getsize(OUTPUT_DEB) / (1024 * 1024)
    print(f"[OK] Debian package created successfully: {OUTPUT_DEB} ({size_mb:.2f} MB)")

if __name__ == "__main__":
    create_deb()
