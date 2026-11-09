#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" -p '{"spec":{"template":{"metadata":{"labels":{"owner":"platform"}}}}}'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s

# Question 2
manifest=/etc/kubernetes/manifests/kube-apiserver.yaml
sed -i -E 's/(--enable-admission-plugins=[^[:space:]"]+)/\1,AlwaysPullImages/' "$manifest"
grep -q 'AlwaysPullImages' "$manifest"
timeout 180 bash -c 'until [[ "$(kubectl run admission-check --image=nginx:1.27-alpine --image-pull-policy=IfNotPresent --dry-run=server -o jsonpath="{.spec.containers[0].imagePullPolicy}" 2>/dev/null)" == Always ]]; do sleep 2; done'
