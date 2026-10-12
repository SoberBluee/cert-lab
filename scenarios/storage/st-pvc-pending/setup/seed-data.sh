#!/usr/bin/env bash
set -euo pipefail

mkdir -p /srv/data
echo "cka-storage-ok" > /srv/data/seed.txt
grep -qx cka-storage-ok /srv/data/seed.txt
