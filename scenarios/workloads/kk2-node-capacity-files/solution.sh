#!/usr/bin/env bash
set -euo pipefail
cpu=$(kubectl get node worker-1 -o jsonpath='{.status.capacity.cpu}')
mem=$(kubectl get node worker-1 -o jsonpath='{.status.capacity.memory}')
mkdir -p /opt/course
echo "cpu: ${cpu}" >/opt/course/worker-1-cpu.txt
echo "memory: ${mem}" >/opt/course/worker-1-memory.txt
chown -R ubuntu:ubuntu /opt/course
