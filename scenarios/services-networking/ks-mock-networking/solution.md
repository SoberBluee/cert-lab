## Solution

### Question 1: NetworkPolicy

```bash
kubectl -n ${Q1_NS} get networkpolicy
kubectl get ns --show-labels
```

<!-- fault Q1_KIND=client-egress -->
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
<!-- /fault -->
<!-- fault Q1_KIND=db-ingress -->
`allow-all-egress` only concerns egress, so it does not get in the way here. The trap is in the `from` list:

```yaml
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
          podSelector: { matchLabels: { role: probe } }       # no dash: same entry = AND
      ports: [{ protocol: TCP, port: 5432 }]
```

The second entry has `namespaceSelector` and `podSelector` together, which means "Pods labelled `role=probe` in namespaces labelled `team=monitoring`". Written as two list entries (a dash before `podSelector`), it would mean "any Pod in a monitoring namespace, **or** any `role=probe` Pod in `${Q1_NS}`". Then `other` in `${Q1_NS}-mon` would get through. A `podSelector` alone only matches Pods in the policy's own namespace, so `probe` in `${Q1_NS}-dev` stays blocked either way.

```bash
kubectl -n ${Q1_NS}-mon exec probe -- wget -qO- -T 3 http://db.${Q1_NS}:5432/   # db ok
kubectl -n ${Q1_NS}-mon exec other -- wget -qO- -T 3 http://db.${Q1_NS}:5432/   # timed out
kubectl -n ${Q1_NS}-dev exec probe -- wget -qO- -T 3 http://db.${Q1_NS}:5432/   # timed out
```
<!-- /fault -->
<!-- fault Q1_KIND=ns-isolation -->
Two policies, because they add up:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: same-namespace-only, namespace: ${Q1_NS} }
spec:
  podSelector: {}                   # every Pod in ${Q1_NS}
  policyTypes: [Ingress]            # egress stays open
  ingress:
    - from: [{ podSelector: {} }]   # every Pod of this namespace
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
```

`cache` is selected by both policies, so it accepts the union: its own namespace on any port, plus monitoring namespaces on port 80. `db` is only selected by the first. Listing `Egress` in `policyTypes` without egress rules would cut off all outgoing traffic, DNS included.

```bash
kubectl -n ${Q1_NS}-mon exec other -- wget -qO- -T 3 http://cache.${Q1_NS}/       # nginx page
kubectl -n ${Q1_NS}-mon exec probe -- wget -qO- -T 3 http://db.${Q1_NS}:5432/    # timed out
kubectl -n ${Q1_NS}-dev exec probe -- wget -qO- -T 3 http://cache.${Q1_NS}/      # timed out
```
<!-- /fault -->

### Question 2: Gateway API and the hidden Service bug

<!-- fault Q2_KIND=path-split -->
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

With the route in place, `/` works but `/api/` fails.
<!-- /fault -->
<!-- fault Q2_KIND=header-match -->
```yaml
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
```

Header matches are `Exact` by default, and header names are case-insensitive. With the route in place, requests without the header work, but those with `X-Backend: api` fail.
<!-- /fault -->
<!-- fault Q2_KIND=two-hosts -->
```yaml
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
```

With the routes in place, `www` works but `api` fails.
<!-- /fault -->

Service `api` targets the named port `web`, but the container port is named `http`, so the Service has no ready endpoints:

```bash
kubectl -n ${Q2_NS} get endpointslices -l kubernetes.io/service-name=api
kubectl -n ${Q2_NS} patch svc api --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```

### Question 3: DNS for individual Pods

<!-- fault Q3_KIND=headless-sts -->
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
<!-- /fault -->
<!-- fault Q3_KIND=pod-subdomain -->
```yaml
apiVersion: v1
kind: Service
metadata: { name: ${Q3_STS}-hl, namespace: ${Q3_NS} }
spec:
  clusterIP: None
  selector: { app: ${Q3_STS} }
  ports: [{ port: 80 }]
---
apiVersion: v1
kind: Pod
metadata: { name: ${Q3_STS}-primary, namespace: ${Q3_NS}, labels: { app: ${Q3_STS} } }
spec:
  hostname: primary
  subdomain: ${Q3_STS}-hl
  containers: [{ name: nginx, image: nginx:1.27-alpine }]
```

```bash
echo primary.${Q3_STS}-hl.${Q3_NS}.svc.cluster.local > /opt/course/q3/fqdn
kubectl -n ${Q3_NS} exec ${Q3_STS}-primary -- nslookup primary.${Q3_STS}-hl.${Q3_NS}.svc.cluster.local
```

This is what a StatefulSet does for you: it sets `hostname` to the Pod name and `subdomain` to `serviceName`. The record only exists while a headless Service named like the subdomain selects the Pod.
<!-- /fault -->
<!-- fault Q3_KIND=sts-scale -->
```bash
kubectl -n ${Q3_NS} get svc ${Q3_STS}-hl      # CLUSTER-IP 10.96.x.x: not headless
```

Per-Pod DNS records (`<pod>.<service>.<ns>.svc.cluster.local`) only exist for **headless** Services. `spec.clusterIP` is immutable, so recreate the Service:

```bash
kubectl -n ${Q3_NS} get svc ${Q3_STS}-hl -o yaml > svc.yaml
kubectl -n ${Q3_NS} delete svc ${Q3_STS}-hl
# in svc.yaml: set clusterIP: None, remove clusterIPs, resourceVersion, uid and status
kubectl apply -f svc.yaml
kubectl -n ${Q3_NS} scale statefulset ${Q3_STS} --replicas=4
kubectl -n ${Q3_NS} rollout status statefulset ${Q3_STS}
echo ${Q3_STS}-3.${Q3_STS}-hl.${Q3_NS}.svc.cluster.local > /opt/course/q3/fqdn
```

The StatefulSet itself can stay: `serviceName` already names `${Q3_STS}-hl`, and the records appear as soon as a headless Service with that name selects the Pods. Ordinals start at 0, so with 4 replicas the newest Pod is `${Q3_STS}-3`.
<!-- /fault -->

### Question 4: network facts

<!-- fault Q4_KIND=cidrs-proxy-dns -->
```bash
sudo grep -- --cluster-cidr /etc/kubernetes/manifests/kube-controller-manager.yaml
sudo grep -- --service-cluster-ip-range /etc/kubernetes/manifests/kube-apiserver.yaml
curl -s localhost:10249/proxyMode          # or: kubectl -n kube-system logs ds/kube-proxy | grep -i proxier
kubectl -n kube-system get svc kube-dns -o jsonpath='{.spec.clusterIP}'
```

Write only the values, one per file.
<!-- /fault -->
<!-- fault Q4_KIND=node-cidrs-cni -->
```bash
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name} {.spec.podCIDR}{"\n"}{end}' > /opt/course/q4/node-cidrs
ls /etc/cni/net.d/                        # 10-calico.conflist (+ calico-kubeconfig)
jq -r '.plugins[0].type' /etc/cni/net.d/10-calico.conflist      # calico
echo calico > /opt/course/q4/cni
echo /etc/cni/net.d/10-calico.conflist > /opt/course/q4/cni-config
```

The runtime loads the first `.conf`/`.conflist`/`.json` file in lexical order. The controller manager hands each node a slice of `--cluster-cidr` (`.spec.podCIDR`). Calico runs its own IPAM, so its Pod IPs need not come from that slice.
<!-- /fault -->
<!-- fault Q4_KIND=nodeport-coredns -->
```bash
sudo grep -- --service-node-port-range /etc/kubernetes/manifests/kube-apiserver.yaml || echo "not set: default 30000-32767"
kubectl -n kube-system get cm coredns -o jsonpath='{.data.Corefile}'
#   forward . /etc/resolv.conf { ... }    -> upstream /etc/resolv.conf (of the CoreDNS Pod's node)
sudo grep clusterDomain /var/lib/kubelet/config.yaml    # cluster.local
```

Write only the values, one per file: `30000-32767`, `/etc/resolv.conf`, `cluster.local`.
<!-- /fault -->
