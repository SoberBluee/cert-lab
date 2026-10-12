#!/usr/bin/env bash
# NS, APP and PORT come from the scenario variables.
set -euo pipefail

kubectl -n "$NS" patch service "$APP-svc" --type merge \
  -p "{\"spec\":{\"selector\":{\"app\":\"$APP\",\"tier\":\"backend\"},\"ports\":[{\"port\":$PORT,\"targetPort\":80}]}}"
