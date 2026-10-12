#!/usr/bin/env bash
# The node controller marks the node Unknown after the grace period (about 40-50s).
set -euo pipefail

status() { kubectl get node worker-1 -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'; }
until [[ "$(status)" != "True" ]]; do sleep 3; done
