#!/usr/bin/env bash
# Applied by "cka verify" on controlplane. Runs as root.
set -euo pipefail

# Question 1
kubectl -n "$Q1_NS" patch networkpolicy allow-all-egress --type=json \
  -p '[{"op":"replace","path":"/spec/podSelector","value":{"matchExpressions":[{"key":"role","operator":"NotIn","values":["client"]}]}}]'
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: client-egress, namespace: ${Q1_NS} }
spec:
  podSelector: { matchLabels: { role: client } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { role: db } } }]
      ports: [{ protocol: TCP, port: 5432 }]
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
EOF

# Question 2
kubectl -n "$Q2_NS" patch service api --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: app, namespace: ${Q2_NS} }
spec:
  parentRefs: [{ name: traefik-gateway, namespace: traefik, sectionName: web }]
  hostnames: [app.${Q2_NS}.lab]
  rules:
    - matches: [{ path: { type: PathPrefix, value: /api } }]
      backendRefs: [{ name: api, port: 8080 }]
    - backendRefs: [{ name: frontend, port: 80 }]
EOF

# Question 3
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata: { name: ${Q3_STS}-hl, namespace: ${Q3_NS} }
spec:
  clusterIP: None
  selector: { app: ${Q3_STS} }
  ports: [{ port: 80 }]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: ${Q3_STS}, namespace: ${Q3_NS} }
spec:
  serviceName: ${Q3_STS}-hl
  podManagementPolicy: Parallel
  replicas: 3
  selector: { matchLabels: { app: ${Q3_STS} } }
  template:
    metadata: { labels: { app: ${Q3_STS} } }
    spec:
      containers: [{ name: nginx, image: nginx:1.27-alpine, ports: [{ containerPort: 80 }] }]
EOF
echo "${Q3_STS}-1.${Q3_STS}-hl.${Q3_NS}.svc.cluster.local" > /opt/course/q3/fqdn

# Question 4
grep -oE -- '--cluster-cidr=[^ "]+' /etc/kubernetes/manifests/kube-controller-manager.yaml | cut -d= -f2 > /opt/course/q4/pod-cidr
grep -oE -- '--service-cluster-ip-range=[^ "]+' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2 > /opt/course/q4/service-cidr
curl -s http://127.0.0.1:10249/proxyMode > /opt/course/q4/proxy-mode
kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.clusterIP}' > /opt/course/q4/dns-ip

kubectl -n "$Q3_NS" rollout status "statefulset/$Q3_STS" --timeout=180s
