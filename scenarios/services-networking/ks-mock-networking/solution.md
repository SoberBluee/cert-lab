## Solution

### Question 1: egress lock-down

```bash
kubectl -n ${Q1_NS} get networkpolicy
```

`allow-all-egress` selects every Pod (`podSelector: {}`) and allows all egress. NetworkPolicies are a union of allows, so a new policy for `client` cannot take that away. Narrow the existing policy instead of deleting it, so `cache` keeps its open egress:

```bash
kubectl -n ${Q1_NS} edit networkpolicy allow-all-egress
```

```yaml
spec:
  podSelector:
    matchExpressions: [{ key: role, operator: NotIn, values: [client] }]
```

Then:

```yaml
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
```

```bash
kubectl -n ${Q1_NS} exec client -- wget -qO- -T 3 http://db:5432/     # db ok
kubectl -n ${Q1_NS} exec client -- wget -qO- -T 3 http://cache/       # timed out
```

### Question 2: HTTPRoute and the hidden Service bug

```yaml
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
```

With the route in place, `/` works but `/api/` fails. Service `api` targets the named port `web`, but the container port is named `http`, so the Service has no ready endpoints:

```bash
kubectl -n ${Q2_NS} get endpointslices -l kubernetes.io/service-name=api
kubectl -n ${Q2_NS} patch svc api --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```

### Question 3: headless Service and StatefulSet

```yaml
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
      containers: [{ name: nginx, image: nginx:1.27-alpine }]
```

```bash
echo ${Q3_STS}-1.${Q3_STS}-hl.${Q3_NS}.svc.cluster.local > /opt/course/q3/fqdn
```

### Question 4: network facts

```bash
sudo grep -- --cluster-cidr /etc/kubernetes/manifests/kube-controller-manager.yaml
sudo grep -- --service-cluster-ip-range /etc/kubernetes/manifests/kube-apiserver.yaml
curl -s localhost:10249/proxyMode          # or: kubectl -n kube-system logs ds/kube-proxy | grep -i proxier
kubectl -n kube-system get svc kube-dns -o jsonpath='{.spec.clusterIP}'
```

Write only the values, one per file.
