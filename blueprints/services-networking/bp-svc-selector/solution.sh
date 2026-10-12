#!/usr/bin/env bash
set -euo pipefail

kubectl -n "$NS" patch service "$APP" --type merge -p "{\"spec\":{\"selector\":{\"app\":\"$APP\"}}}"
