#!/usr/bin/env bash
# Runs as root on the node named in scenario.yaml after the base snapshot is restored.
# KUBECONFIG points at the admin kubeconfig; scenario variables are environment variables ($NS).
set -euo pipefail

kubectl create namespace "$NS"
# TODO break something


