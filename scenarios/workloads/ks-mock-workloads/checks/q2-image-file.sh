#!/usr/bin/env bash
# Prints "ok" when /opt/course/q2/image.txt holds the image of the security-approved revision ($Q2_TARGET).
set -uo pipefail

want="nginx:1.2$((4 + Q2_TARGET))-alpine"
have="$(tr -d '[:space:]' < /opt/course/q2/image.txt 2>/dev/null)"

if [[ "$have" == "$want" ]]; then echo ok; else echo "file=$have"; fi
