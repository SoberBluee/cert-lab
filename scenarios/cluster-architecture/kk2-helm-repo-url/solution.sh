#!/usr/bin/env bash
set -euo pipefail
echo -n 'http://controlplane:8879' >/opt/course/nginx-helm-url.txt
chown ubuntu:ubuntu /opt/course/nginx-helm-url.txt
