#!/usr/bin/env bash
set -euo pipefail

# Question 2
sed -i 's/^KUBELET_EXTRA_ARGS=.*/KUBELET_EXTRA_ARGS=/' /etc/default/kubelet
systemctl restart kubelet
