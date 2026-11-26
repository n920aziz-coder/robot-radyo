#!/bin/sh
# Robot Radyo: runs the server and restarts it if it stops.
# The robot's own programs run at nice -20 and always come first: the radio runs at low priority (nice 10),
# and if memory ever runs out, the kernel picks the radio first (oom_score_adj 1000, inherited by its children).
D=$(cd "$(dirname "$0")/.." && pwd)
PORT=$(cat "$D/web/port" 2>/dev/null || echo 8080)
export PORT
LOG=/tmp/robot-radyo.log
export LOG_FILE="$LOG"
echo 1000 > /proc/self/oom_score_adj 2>/dev/null

# If the server dies abruptly, its ffmpeg keeps the radio playing and nothing could stop it any more.
# Stop such orphans (parent = 1) of this installation; aplay ends by itself when ffmpeg is gone.
cleanup() {
  for p in /proc/[0-9]*; do
    [ "$(readlink "$p/exe" 2>/dev/null)" = "$D/ffmpeg" ] || continue
    set -- $(cat "$p/stat" 2>/dev/null)
    [ "$4" = 1 ] && kill -9 "${p#/proc/}" 2>/dev/null
  done
}
trap 'kill $CHILD 2>/dev/null; wait $CHILD 2>/dev/null; cleanup; exit 0' TERM INT

DELAY=5
while true; do
  # keep the log small (/tmp is a small RAM disk); the server also trims it while running
  [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1000000 ] && mv "$LOG" "$LOG.1"
  START=$(date +%s)
  nice -n 10 "$D/node" "$D/web/server.mjs" >> "$LOG" 2>&1 &
  CHILD=$!
  wait $CHILD
  cleanup
  # stopping right after the start (e.g. port in use): wait longer each time, up to one minute
  if [ $(( $(date +%s) - START )) -lt 60 ]; then DELAY=$(( DELAY * 2 )); [ $DELAY -gt 60 ] && DELAY=60; else DELAY=5; fi
  echo "$(date '+%Y-%m-%d %H:%M:%S') server stopped, restarting in ${DELAY}s" >> "$LOG"
  sleep $DELAY
done
