#!/usr/bin/env bash
set -euo pipefail

CONFIG=/var/lib/kubelet/config.yaml
cp -a "$CONFIG" "${CONFIG}.cka-bak"

python3 - <<'PY'
from pathlib import Path
p = Path("/var/lib/kubelet/config.yaml")
lines = p.read_text().splitlines(keepends=True)
out = []
skip = False
for line in lines:
    if line.startswith("evictionHard:"):
        skip = True
        continue
    if skip:
        if line[:1] not in (" ", "\t") and line.strip():
            skip = False
        else:
            continue
    if not skip:
        out.append(line)
out.append("evictionHard:\n")
out.append('  memory.available: "99%"\n')
p.write_text("".join(out))
PY

grep -q 'memory.available: "99%"' "$CONFIG" || { echo "could not set evictionHard" >&2; exit 1; }
systemctl restart kubelet || true
