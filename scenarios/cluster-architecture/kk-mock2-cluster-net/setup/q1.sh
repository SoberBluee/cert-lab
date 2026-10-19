#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/course
chown -R ubuntu:ubuntu /opt/course
sudo -u ubuntu -H helm repo remove lab >/dev/null 2>&1 || true
sudo -u ubuntu -H helm repo add lab http://controlplane:8879 >/dev/null
sudo -u ubuntu -H helm repo update >/dev/null
