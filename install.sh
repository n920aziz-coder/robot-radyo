#!/usr/bin/env bash
# Robot Radyo installer.
# Run this on a computer (Linux, macOS, WSL or Git Bash on Windows) that can SSH into your Valetudo robot as root.
#
#   ./install.sh [options] <robot-ip-or-host>
#
# Options:
#   -i, --key FILE   SSH private key for the robot
#   --dir DIR        install directory on the robot (default: /mnt/data/robot-radyo)
#   --port PORT      web port of the Valetudo + radio page (default: 8080)
#   --reboot         reboot the robot when done (needed once so its own voice can play over the radio)
#   --dry-run        only check the robot and download/verify the files; change nothing
set -euo pipefail

DIR=/mnt/data/robot-radyo
PORT=8080
KEY=""
REBOOT=0
DRY=0
ROBOT=""

# Pinned downloads (override with environment variables if a source moves).
NODE_URL="${NODE_URL:-https://github.com/yao-pkg/pkg-fetch/releases/download/v3.6/node-v22.23.5-linuxstatic-armv7}"
NODE_SHA256="${NODE_SHA256:-fa33235bb93c20c48289daee04fc83a1adfe6c4475dbca3d8426ba9800d77b37}"
FFMPEG_URL="${FFMPEG_URL:-https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-armhf-static.tar.xz}"
FFMPEG_SHA256="${FFMPEG_SHA256:-}"   # empty: verified with the .md5 published next to the file
ALSA_DEB_URL="${ALSA_DEB_URL:-http://ports.ubuntu.com/ubuntu-ports/pool/main/a/alsa-utils/alsa-utils_1.0.27.2-1ubuntu2_armhf.deb}"
ALSA_DEB_SHA256="${ALSA_DEB_SHA256:-7295f889d89d2d38455e1f21f46d219553fd5c4b37939b088cf301bf25230fd1}"
CACERT_URL="${CACERT_URL:-https://curl.se/ca/cacert.pem}"

msg() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    -i|--key) KEY="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --reboot) REBOOT=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) ROBOT="$1"; shift ;;
  esac
done
[ -n "$ROBOT" ] || { usage; exit 1; }
case "$ROBOT" in *@*) ;; *) ROBOT="root@$ROBOT" ;; esac
case "$DIR" in /mnt/data/?*) ;; *) die "--dir must be under /mnt/data (it survives firmware updates)" ;; esac
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ne 80 ] && [ "$PORT" -lt 65536 ] || die "invalid --port (80 is used by Valetudo)"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
[ -n "$KEY" ] && SSH_OPTS+=(-i "$KEY")
rsh() { ssh "${SSH_OPTS[@]}" "$ROBOT" "$@"; }
push() { rsh "cat > '$2'" < "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required on this computer"; }
need curl; need ssh; need tar
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum < "$1" | cut -d' ' -f1; else shasum -a 256 < "$1" | cut -d' ' -f1; fi; }
md5of() { if command -v md5sum >/dev/null 2>&1; then md5sum < "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || die "sha256sum or shasum is required"

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------- 1. check the robot ----------
msg "Checking the robot ($ROBOT)"
INFO=$(rsh 'echo "arch=$(uname -m)"
  [ -f /etc/init/rcS ] && echo rcs=yes
  pidof RoboController >/dev/null 2>&1 && echo roborock=yes
  pidof valetudo >/dev/null 2>&1 && echo valetudo=yes
  [ -e /usr/lib/arm-linux-gnueabihf/libasound.so.2 ] && echo alsa=yes
  echo "free=$(df -k /mnt/data | tail -1 | awk "{print \$4}")"') || die "cannot connect to $ROBOT over SSH"
grep -q 'arch=armv7' <<<"$INFO" || die "unsupported robot CPU (armv7l needed): $(grep arch <<<"$INFO")"
for k in rcs roborock valetudo alsa; do
  grep -q "$k=yes" <<<"$INFO" || die "this version supports Valetudo on Roborock gen1/gen2 (Xiaomi Vacuum, Roborock S5). Missing: $k"
done
FREE=$(sed -n 's/^free=//p' <<<"$INFO")
[ "${FREE:-0}" -gt 150000 ] || die "not enough free space in /mnt/data (need 150 MB, have $((FREE / 1024)) MB)"
msg "Robot looks compatible ($(( FREE / 1024 )) MB free)"

# ---------- 2. download and verify ----------
dl() { curl -fL --retry 3 --connect-timeout 20 -s -S -o "$2" "$1" || die "download failed: $1"; }
msg "Downloading Node.js (static, armv7)"
dl "$NODE_URL" "$WORK/node"
[ "$(sha256 "$WORK/node")" = "$NODE_SHA256" ] || die "Node.js checksum mismatch"
msg "Downloading ffmpeg (static, armhf)"
dl "$FFMPEG_URL" "$WORK/ffmpeg.tar.xz"
if [ -n "$FFMPEG_SHA256" ]; then
  [ "$(sha256 "$WORK/ffmpeg.tar.xz")" = "$FFMPEG_SHA256" ] || die "ffmpeg checksum mismatch"
else
  dl "$FFMPEG_URL.md5" "$WORK/ffmpeg.md5"
  [ "$(md5of "$WORK/ffmpeg.tar.xz")" = "$(cut -d' ' -f1 < "$WORK/ffmpeg.md5")" ] || die "ffmpeg checksum mismatch"
fi
msg "Downloading alsa-utils (aplay, amixer) from the Ubuntu 14.04 archive"
dl "$ALSA_DEB_URL" "$WORK/alsa.deb"
[ "$(sha256 "$WORK/alsa.deb")" = "$ALSA_DEB_SHA256" ] || die "alsa-utils checksum mismatch"
msg "Downloading CA certificates"
dl "$CACERT_URL" "$WORK/cacert.pem"
dl "$CACERT_URL.sha256" "$WORK/cacert.sha256"
[ "$(sha256 "$WORK/cacert.pem")" = "$(cut -d' ' -f1 < "$WORK/cacert.sha256")" ] || die "CA bundle checksum mismatch"

# ---------- 3. unpack ----------
msg "Unpacking"
mkdir -p "$WORK/ff" "$WORK/alsa"
tar -xJf "$WORK/ffmpeg.tar.xz" -C "$WORK/ff"
FFMPEG_BIN=$(find "$WORK/ff" -type f -name ffmpeg | head -1)
[ -n "$FFMPEG_BIN" ] || die "ffmpeg not found in the archive"
# .deb files are "ar" archives; we only need data.tar.xz from it
if command -v ar >/dev/null 2>&1; then (cd "$WORK" && ar x alsa.deb data.tar.xz)
elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$WORK/alsa.deb" -C "$WORK" data.tar.xz
elif [ -x /c/Windows/System32/tar.exe ]; then (cd "$WORK" && /c/Windows/System32/tar.exe -xf alsa.deb data.tar.xz)
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$WORK/alsa.deb" "$WORK/data.tar.xz" <<'PY'
import sys
d = open(sys.argv[1], 'rb').read()
assert d[:8] == b'!<arch>\n'
i = 8
while i < len(d):
    name = d[i:i + 16].decode().strip().rstrip('/'); size = int(d[i + 48:i + 58].decode().strip()); i += 60
    if name == 'data.tar.xz':
        open(sys.argv[2], 'wb').write(d[i:i + size]); break
    i += size + (size % 2)
PY
else die "one of 'ar', 'bsdtar' or 'python3' is needed to unpack alsa-utils"; fi
[ -f "$WORK/data.tar.xz" ] || die "could not unpack alsa-utils"
tar -xJf "$WORK/data.tar.xz" -C "$WORK/alsa" ./usr/bin/aplay ./usr/bin/amixer
msg "All downloads verified"

if [ "$DRY" = 1 ]; then
  msg "Dry run: nothing was changed on the robot. Files that would be installed:"
  ls -la "$WORK/node" "$FFMPEG_BIN" "$WORK/alsa/usr/bin/aplay" "$WORK/alsa/usr/bin/amixer" "$WORK/cacert.pem"
  exit 0
fi

# ---------- 4. install ----------
msg "Installing to $ROBOT:$DIR"
rsh "mkdir -p '$DIR/web'; [ -f /etc/init/S12robotradyo ] && PATH=/sbin:/usr/sbin:/bin:/usr/bin /etc/init/S12robotradyo stop >/dev/null 2>&1; true"
push "$WORK/node" "$DIR/node"
push "$FFMPEG_BIN" "$DIR/ffmpeg"
push "$WORK/alsa/usr/bin/aplay" "$DIR/aplay"
push "$WORK/alsa/usr/bin/amixer" "$DIR/amixer"
push "$WORK/cacert.pem" "$DIR/cacert.pem"
for f in server.mjs panel.js i18n.js run.sh; do push "$HERE/robot/web/$f" "$DIR/web/$f"; done
echo "$PORT" > "$WORK/port"; push "$WORK/port" "$DIR/web/port"
rsh "chmod 755 '$DIR/node' '$DIR/ffmpeg' '$DIR/aplay' '$DIR/amixer' '$DIR/web/run.sh'"

msg "Checking the programs on the robot"
rsh "echo 'console.log(\"node \" + process.version)' > /tmp/rr-v.mjs && '$DIR/node' /tmp/rr-v.mjs; rm -f /tmp/rr-v.mjs
  '$DIR/ffmpeg' -hide_banner -version | head -1; '$DIR/aplay' --version" || die "the downloaded programs do not run on this robot"

msg "Sharing the sound card with the robot (/etc/asound.conf) and enabling start at boot"
rsh "if [ -f /etc/asound.conf ] && ! grep -q 'Robot Radyo' /etc/asound.conf; then cp /etc/asound.conf /etc/asound.conf.robot-radyo-backup; fi"
push "$HERE/robot/system/asound.conf" /etc/asound.conf
sed "s#@DIR@#$DIR#g" "$HERE/robot/system/S12robotradyo" > "$WORK/S12robotradyo"
push "$WORK/S12robotradyo" /etc/init/S12robotradyo
rsh "chmod 755 /etc/init/S12robotradyo; PATH=/sbin:/usr/sbin:/bin:/usr/bin /etc/init/S12robotradyo start >/dev/null"

msg "Starting"
OK=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  if rsh "wget -q -O - http://127.0.0.1:$PORT/robot-radyo/api/radyolar >/dev/null 2>&1 || curl -fs http://127.0.0.1:$PORT/robot-radyo/api/radyolar >/dev/null 2>&1"; then OK=1; break; fi
done
[ "$OK" = 1 ] || die "the server did not start; see /tmp/robot-radyo.log on the robot"

HOST="${ROBOT#*@}"
msg "Done! Open http://$HOST:$PORT and log in with your Valetudo user name and password."
echo "    Pull the handle on the right edge of the page, pick your country and press \"Prepare my list\"."
if [ "$REBOOT" = 1 ]; then
  msg "Rebooting the robot (about 1 minute)"
  rsh "/sbin/reboot" || true
else
  echo "    Reboot the robot once (e.g. ./install.sh --reboot, or 'reboot' over SSH) so that its own voice"
  echo "    prompts can play while the radio is on. Until then they are silent while the radio plays."
fi
