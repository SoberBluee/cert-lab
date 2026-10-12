#!/usr/bin/env bash
set -euo pipefail

kubectl run dnsutils --image=busybox:1.36 --restart=Never -- sleep infinity
kubectl wait --for=condition=Ready pod/dnsutils --timeout=180s

for _ in $(seq 1 15); do
  kubectl exec dnsutils -- nslookup -timeout=3 kubernetes.default.svc.cluster.local >/dev/null 2>&1 && break
  sleep 2
done
kubectl exec dnsutils -- nslookup -timeout=3 kubernetes.default.svc.cluster.local >/dev/null

kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > /tmp/Corefile
sed -i -E 's|^(\s*)forward \. /etc/resolv\.conf|\1forwardd . /etc/resolv.conf|' /tmp/Corefile
grep -qE '^\s*forwardd \. /etc/resolv\.conf' /tmp/Corefile || { echo "could not modify the Corefile" >&2; exit 1; }
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/Corefile --dry-run=client -o yaml | kubectl replace -f -
rm -f /tmp/Corefile

# The reload plugin keeps the last good config, so only new Pods pick up the broken one.
kubectl -n kube-system delete pod -l k8s-app=kube-dns --wait=false

ready() { kubectl -n kube-system get deployment coredns -o jsonpath='{.status.readyReplicas}' 2>/dev/null; }
for _ in $(seq 1 60); do
  [[ -z "$(ready)" || "$(ready)" == 0 ]] && break
  sleep 3
done
[[ -z "$(ready)" || "$(ready)" == 0 ]] || { echo "CoreDNS is still Ready after breaking the Corefile" >&2; exit 1; }

for _ in $(seq 1 20); do
  kubectl exec dnsutils -- nslookup -timeout=2 kubernetes.default.svc.cluster.local >/dev/null 2>&1 || exit 0
  sleep 3
done
echo "DNS still resolves after breaking CoreDNS" >&2
exit 1
