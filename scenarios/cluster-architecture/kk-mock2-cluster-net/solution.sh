#!/usr/bin/env bash
set -euo pipefail

# q1
echo -n 'http://controlplane:8879' >/opt/course/nginx-helm-url.txt
chown ubuntu:ubuntu /opt/course/nginx-helm-url.txt

# q2
rm -rf "${Q2_DATADIR}"
etcdutl snapshot restore "${Q2_SNAPSHOT}" --data-dir "${Q2_DATADIR}"

# q4
kubectl -n "${Q4_NS}" apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: ${Q4_APP}-route
spec:
  parentRefs:
    - name: traefik-gateway
      namespace: traefik
      sectionName: web
  hostnames: ["${Q4_APP}.${Q4_NS}.lab"]
  rules:
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - name: ${Q4_APP}
          port: 80
EOF
kubectl -n "${Q4_NS}" delete ingress "${Q4_APP}" --ignore-not-found
for _ in $(seq 1 60); do
  curl -s -m 3 -H "Host: ${Q4_APP}.${Q4_NS}.lab" http://controlplane:30080/ | grep -q "${Q4_APP} ok" && break
  sleep 2
done

# Wait until the restored worker can schedule Pods (CNI fix ran on workers earlier).
for _ in $(seq 1 60); do
  ready=$(kubectl get node "${Q5_NODE}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
  [[ "$ready" == "True" ]] && break
  sleep 2
done
kubectl delete pod cni-probe --ignore-not-found >/dev/null 2>&1 || true
