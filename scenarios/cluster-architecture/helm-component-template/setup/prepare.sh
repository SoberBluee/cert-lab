#!/usr/bin/env bash
set -euo pipefail
export HOME=/root

kubectl delete namespace monitoring --ignore-not-found --wait=true >/dev/null
mkdir -p /opt/course/helm
rm -f /opt/course/helm/node-agent.yaml /opt/course/helm/default-interval.txt
chown -R ubuntu:ubuntu /opt/course

helm repo add lab http://controlplane:8879 >/dev/null
helm repo update lab >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo add lab http://controlplane:8879 >/dev/null
runuser -u ubuntu -- env HOME=/home/ubuntu helm repo update lab >/dev/null
