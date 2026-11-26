#!/usr/bin/env bash
# Robot Radyo uninstaller: removes everything install.sh added and restores the robot's sound settings.
#
#   bash uninstall.sh [-i KEY] [--dir DIR] [--yes] <robot-ip-or-host>
set -euo pipefail

DIR=/mnt/data/robot-radyo
KEY=""
YES=0
ROBOT=""
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
needval() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }
while [ $# -gt 0 ]; do
  case "$1" in
    -i|--key) needval "$@"; KEY="$2"; shift 2 ;;
    --dir) needval "$@"; DIR="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) ROBOT="$1"; shift ;;
  esac
done
[ -n "$ROBOT" ] || die "usage: bash uninstall.sh [-i KEY] [--dir DIR] [--yes] <robot>"
case "$ROBOT" in *@*) ;; *) ROBOT="root@$ROBOT" ;; esac
# only a plain folder under /mnt/data (no "..", spaces or special characters)
[[ "$DIR" =~ ^/mnt/data/[A-Za-z0-9._/-]+$ && "$DIR" != *..* ]] || die "--dir must be a plain path under /mnt/data"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
[ -n "$KEY" ] && SSH_OPTS+=(-i "$KEY")

echo "This removes from $ROBOT:"
echo "  - $DIR (programs, favourite stations and settings)"
echo "  - /etc/init/S12robotradyo (start at boot)"
echo "  - /etc/asound.conf (the previous one is restored if there was one)"
if [ "$YES" != 1 ]; then
  read -r -p "Type 'yes' to continue: " a
  [ "$a" = yes ] || { echo "Cancelled."; exit 1; }
fi

ssh "${SSH_OPTS[@]}" "$ROBOT" "
  PATH=/sbin:/usr/sbin:/bin:/usr/bin
  [ -f /etc/init/S12robotradyo ] && /etc/init/S12robotradyo stop >/dev/null 2>&1
  rm -f /etc/init/S12robotradyo /var/run/robot-radyo.pid /tmp/robot-radyo-calan.json /tmp/robot-radyo.log /tmp/robot-radyo.log.1
  if [ -f /etc/asound.conf.robot-radyo-backup ]; then mv /etc/asound.conf.robot-radyo-backup /etc/asound.conf
  elif grep -q 'Robot Radyo' /etc/asound.conf 2>/dev/null; then rm -f /etc/asound.conf; fi
  # delete the folder only if it really is a Robot Radyo installation
  if [ -f '$DIR/web/server.mjs' ] && [ -x '$DIR/node' ]; then rm -rf '$DIR'; fi
  echo removed
" | grep -q removed || die "uninstall failed"
echo "Robot Radyo was removed. Reboot the robot once so its sound program uses the original settings again."
