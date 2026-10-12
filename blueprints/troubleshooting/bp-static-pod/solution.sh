#!/usr/bin/env bash
# Runs on NODE.
set -euo pipefail

sed -i "s#image: .*#image: nginx:1.27-alpine#" "/etc/kubernetes/manifests/$NAME.yaml"
