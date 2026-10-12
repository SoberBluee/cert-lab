#!/usr/bin/env bash
# Runs on the node chosen by the NODE variable.
set -euo pipefail

systemctl disable --now kubelet
