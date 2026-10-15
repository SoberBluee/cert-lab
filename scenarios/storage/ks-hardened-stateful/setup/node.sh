#!/usr/bin/env bash
# Runs on $NODE. Clears the data directory; with TRAP=stale-dir, leaves a root-owned directory and
# heartbeat file behind from an "earlier attempt", so only a recursive chown makes it writable.
set -euo pipefail

rm -rf "$DATA_DIR"
if [[ "$TRAP" == stale-dir ]]; then
  mkdir -p "$DATA_DIR"
  date > "$DATA_DIR/heartbeat"
  touch -d '2 days ago' "$DATA_DIR/heartbeat"
  chown -R root:root "$DATA_DIR"
  chmod 0700 "$DATA_DIR"
  chmod 0644 "$DATA_DIR/heartbeat"
fi
