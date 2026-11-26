#!/bin/sh
# Robot Radyo: runs the server and restarts it if it crashes.
# The robot's own programs run at nice -20 and always come first: the radio runs at low priority (nice 10),
# and if memory ever runs out, the kernel kills the radio first (oom_score_adj 1000, inherited by its children).
D=$(cd "$(dirname "$0")/.." && pwd)
PORT=$(cat "$D/web/port" 2>/dev/null || echo 8080)
export PORT
LOG=/tmp/robot-radyo.log
export LOG_FILE="$LOG"
echo 1000 > /proc/self/oom_score_adj 2>/dev/null
trap 'kill $CHILD 2>/dev/null; wait $CHILD 2>/dev/null; exit 0' TERM INT
while true; do
  # keep the log small (/tmp is a small RAM disk); the server also trims it while running
  [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1000000 ] && mv "$LOG" "$LOG.1"
  nice -n 10 "$D/node" "$D/web/server.mjs" >> "$LOG" 2>&1 &
  CHILD=$!
  wait $CHILD
  sleep 5
done
