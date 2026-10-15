#!/usr/bin/env bash
set -euo pipefail

rm -rf /opt/course
mkdir -p /opt/course/q1 /opt/course/q3 /opt/course/q4
chown -R ubuntu:ubuntu /opt/course
