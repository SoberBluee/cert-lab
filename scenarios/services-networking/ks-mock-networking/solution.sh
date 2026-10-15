#!/usr/bin/env bash
# Applied by "cka verify" on controlplane. Runs as root. Each question branches on its rolled variant.
set -euo pipefail

# Question 1
case "$Q1_KIND" in
  client-egress)
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
    ;;
  db-ingress)
    kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: db-ingress, namespace: ${Q1_NS} }
spec:
  podSelector: { matchLabels: { role: db } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: { matchLabels: { role: client } }
        - namespaceSelector: { matchLabels: { team: monitoring } }
          podSelector: { matchLabels: { role: probe } }
      ports: [{ protocol: TCP, port: 5432 }]
EOF
    ;;
  ns-isolation)
    kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: same-namespace-only, namespace: ${Q1_NS} }
spec:
  podSelector: {}
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: {} }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: cache-from-monitoring, namespace: ${Q1_NS} }
spec:
  podSelector: { matchLabels: { role: cache } }
  policyTypes: [Ingress]
  ingress:
    - from: [{ namespaceSelector: { matchLabels: { team: monitoring } } }]
      ports: [{ protocol: TCP, port: 80 }]
EOF
    ;;
esac

# Question 2
kubectl -n "$Q2_NS" patch service api --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
case "$Q2_KIND" in
  path-split)
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
    ;;
  header-match)
    kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: app, namespace: ${Q2_NS} }
spec:
  parentRefs: [{ name: traefik-gateway, namespace: traefik, sectionName: web }]
  hostnames: [app.${Q2_NS}.lab]
  rules:
    - matches: [{ headers: [{ name: X-Backend, value: api }] }]
      backendRefs: [{ name: api, port: 8080 }]
    - backendRefs: [{ name: frontend, port: 80 }]
EOF
    ;;
  two-hosts)
    kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: web, namespace: ${Q2_NS} }
spec:
  parentRefs: [{ name: traefik-gateway, namespace: traefik, sectionName: web }]
  hostnames: [www.${Q2_NS}.lab]
  rules: [{ backendRefs: [{ name: frontend, port: 80 }] }]
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: api, namespace: ${Q2_NS} }
spec:
  parentRefs: [{ name: traefik-gateway, namespace: traefik, sectionName: web }]
  hostnames: [api.${Q2_NS}.lab]
  rules: [{ backendRefs: [{ name: api, port: 8080 }] }]
EOF
    ;;
esac

# Question 3
headless() {
  kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata: { name: ${Q3_STS}-hl, namespace: ${Q3_NS} }
spec:
  clusterIP: None
  selector: { app: ${Q3_STS} }
  ports: [{ port: 80 }]
EOF
}
case "$Q3_KIND" in
  headless-sts)
    headless
    kubectl apply -f - <<EOF
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
    ;;
  pod-subdomain)
    headless
    kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata: { name: ${Q3_STS}-primary, namespace: ${Q3_NS}, labels: { app: ${Q3_STS} } }
spec:
  hostname: primary
  subdomain: ${Q3_STS}-hl
  containers: [{ name: nginx, image: nginx:1.27-alpine, ports: [{ containerPort: 80 }] }]
EOF
    echo "primary.${Q3_STS}-hl.${Q3_NS}.svc.cluster.local" > /opt/course/q3/fqdn
    ;;
  sts-scale)
    kubectl -n "$Q3_NS" delete service "${Q3_STS}-hl"
    headless
    kubectl -n "$Q3_NS" scale statefulset "$Q3_STS" --replicas=4
    echo "${Q3_STS}-3.${Q3_STS}-hl.${Q3_NS}.svc.cluster.local" > /opt/course/q3/fqdn
    ;;
esac

# Question 4
case "$Q4_KIND" in
  cidrs-proxy-dns)
    grep -oE -- '--cluster-cidr=[^ "]+' /etc/kubernetes/manifests/kube-controller-manager.yaml | cut -d= -f2 > /opt/course/q4/pod-cidr
    grep -oE -- '--service-cluster-ip-range=[^ "]+' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2 > /opt/course/q4/service-cidr
    curl -s http://127.0.0.1:10249/proxyMode > /opt/course/q4/proxy-mode
    kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.clusterIP}' > /opt/course/q4/dns-ip
    ;;
  node-cidrs-cni)
    kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name} {.spec.podCIDR}{"\n"}{end}' > /opt/course/q4/node-cidrs
    conf="/etc/cni/net.d/$(ls /etc/cni/net.d/ | grep -E '\.(conf|conflist|json)$' | sort | head -1)"
    jq -r '.plugins[0].type' "$conf" > /opt/course/q4/cni
    echo "$conf" > /opt/course/q4/cni-config
    ;;
  nodeport-coredns)
    range=$(grep -oE -- '--service-node-port-range=[^ "]+' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2 || true)
    echo "${range:-30000-32767}" > /opt/course/q4/nodeport-range
    kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | awk '$1 == "forward" {print $3; exit}' > /opt/course/q4/dns-upstream
    awk '$1 == "clusterDomain:" {print $2}' /var/lib/kubelet/config.yaml > /opt/course/q4/cluster-domain
    ;;
esac

case "$Q3_KIND" in
  pod-subdomain) kubectl -n "$Q3_NS" wait --for=condition=Ready "pod/${Q3_STS}-primary" --timeout=120s ;;
  *) kubectl -n "$Q3_NS" rollout status "statefulset/$Q3_STS" --timeout=240s ;;
esac
