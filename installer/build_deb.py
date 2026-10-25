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
Depends: nodejs (>= 16)
Recommends: vsdcraft (>= 1.0.0), spotify-client
Homepage: https://github.com/henry1056/streamdock-spicetify
Description: Spicetify plugin & bridge for VSDCraft Linux (Stream Dock N3)
 Control Spotify desktop directly from your VSDinside Stream Dock N3 macro pad.
 Fully compatible with VSDCraft Linux (https://github.com/henry1056/vsdcraft-linux).
 Provides the StreamDock plugin bundle (com.vsdinside.spicetify.sdPlugin),
 the Spicetify local extension (streamdock.js), and automated setup tools.
"""

    postinst_text = """#!/bin/sh
set -e

# Deploy plugin bundle for current and future users
mkdir -p /etc/skel/.config/vsdcraft/plugins
cp -rf /usr/share/vsdcraft/plugins/com.vsdinside.spicetify.sdPlugin /etc/skel/.config/vsdcraft/plugins/ 2>/dev/null || true

# For any logged in non-root user with home directory, deploy plugin
for udir in /home/*; do
    if [ -d "$udir" ]; then
        target_plugin="$udir/.config/vsdcraft/plugins/com.vsdinside.spicetify.sdPlugin"
        mkdir -p "$udir/.config/vsdcraft/plugins"
        rm -rf "$target_plugin"
        cp -rf /usr/share/vsdcraft/plugins/com.vsdinside.spicetify.sdPlugin "$target_plugin"
        chown -R "$(basename "$udir")":"$(basename "$udir")" "$udir/.config/vsdcraft" 2>/dev/null || true
    fi
done

echo "=========================================================="
echo "  ⚡ Stream Dock Spicetify Integration Installed!"
echo "=========================================================="
echo "  • Compatible with VSDCraft Linux v1.0.0"
echo "  • Plugin deployed to: ~/.config/vsdcraft/plugins/"
echo ""
echo "  To register the Spicetify extension in Spotify, run:"
echo "      streamdock-spicetify-setup"
echo "=========================================================="

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

            # /usr/bin/streamdock-spicetify-setup
            setup_bin = """#!/bin/sh
set -e
echo "=========================================================="
echo "    Stream Dock N3 - Spicetify User Setup                "
echo "=========================================================="

EXT_SRC="/usr/share/vsdcraft/spicetify-extension/streamdock.js"
TARGET_DIR="${HOME}/.config/spicetify/Extensions"
FLATPAK_DIR="${HOME}/.var/app/com.spotify.Client/config/spicetify/Extensions"

mkdir -p "${TARGET_DIR}"
cp -f "${EXT_SRC}" "${TARGET_DIR}/streamdock.js"
echo "✅ Copied streamdock.js to ${TARGET_DIR}/streamdock.js"

if [ -d "${HOME}/.var/app/com.spotify.Client" ]; then
    mkdir -p "${FLATPAK_DIR}"
    cp -f "${EXT_SRC}" "${FLATPAK_DIR}/streamdock.js"
    echo "✅ Copied streamdock.js to Flatpak Spotify extensions"
fi

PLUGIN_SRC="/usr/share/vsdcraft/plugins/com.vsdinside.spicetify.sdPlugin"
USER_PLUGIN_DIR="${HOME}/.config/vsdcraft/plugins"
mkdir -p "${USER_PLUGIN_DIR}"
rm -rf "${USER_PLUGIN_DIR}/com.vsdinside.spicetify.sdPlugin"
cp -rf "${PLUGIN_SRC}" "${USER_PLUGIN_DIR}/"
echo "✅ Deployed StreamDock plugin to ${USER_PLUGIN_DIR}/"

if command -v spicetify >/dev/null 2>&1; then
    echo "⚙️ Configuring Spicetify..."
    spicetify config extensions streamdock.js || true
    echo "🚀 Applying Spicetify patch..."
    spicetify apply || true
    echo "✅ Spicetify extension registered and applied!"
fi

echo ""
echo "🎉 Setup complete! Launch VSDCraft by running: vsdcraft"
"""
            ti = tarfile.TarInfo("./usr/bin/streamdock-spicetify-setup")
            s_content = setup_bin.encode("utf-8")
            ti.size = len(s_content)
            ti.mode = 0o755
            ti.mtime = int(time.time())
            tar.addfile(ti, io.BytesIO(s_content))

            # /usr/bin/streamdock-spicetify-bridge
            bridge_bin = """#!/bin/sh
# Standalone Spicetify Stream Dock Bridge runner
exec /usr/bin/node /usr/share/vsdcraft/plugins/com.vsdinside.spicetify.sdPlugin/plugin/index.js "$@"
"""
            ti = tarfile.TarInfo("./usr/bin/streamdock-spicetify-bridge")
            b_content = bridge_bin.encode("utf-8")
            ti.size = len(b_content)
            ti.mode = 0o755
            ti.mtime = int(time.time())
            tar.addfile(ti, io.BytesIO(b_content))

            # /usr/lib/systemd/user/streamdock-bridge.service
            service_content = """[Unit]
Description=Stream Dock N3 Spicetify Local Bridge
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/streamdock-spicetify-bridge
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
"""
            ti = tarfile.TarInfo("./usr/lib/systemd/user/streamdock-bridge.service")
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
