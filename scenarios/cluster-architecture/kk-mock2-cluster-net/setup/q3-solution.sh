#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
import re, subprocess
raw = subprocess.check_output(
    ["kubectl", "-n", "kube-system", "get", "cm", "coredns", "-o", "jsonpath={.data.Corefile}"],
    text=True,
)
fixed = re.sub(
    r"kubernetes\s+[^\n{]+",
    "kubernetes cka.local cluster.local in-addr.arpa ip6.arpa ",
    raw,
    count=1,
)
open("/tmp/Corefile", "w").write(fixed)
PY
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/Corefile -o yaml --dry-run=client \
  | kubectl apply -f -
kubectl -n kube-system rollout restart deploy/coredns
kubectl -n kube-system rollout status deploy/coredns --timeout=180s
