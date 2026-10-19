## Solution

### Question 1: PersistentVolumeClaim ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
spec:
  storageClassName: manual
  accessModes:
    - "${Q1_ACCESS}"
  resources:
    requests:
      storage: "${Q1_SIZE}"
  selector:
    matchLabels:
      tier: "${Q1_SELECT_TIER}"
EOF
kubectl -n "${Q1_NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${Q1_NAME}" --timeout=60s
kubectl -n "${Q1_NS}" delete pod "${Q1_NAME}-app" --ignore-not-found --wait=true
kubectl -n "${Q1_NS}" delete pvc "${Q1_NAME}" --wait=true
kubectl wait --for=jsonpath='{.status.phase}'=Released "pv/${Q1_NAME}-pv" --timeout=60s
```

### Question 2: Access for ${Q2_SA}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: "${Q2_SA}"
  namespace: "${Q2_NS}"
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: "${Q2_SA}-reader"
  namespace: "${Q2_NS}"
rules:
  - apiGroups:
      - ""
    resources:
      - "${Q2_RESOURCE}"
    verbs:
      - get
      - list
      - watch
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: "${Q2_SA}-reader"
  namespace: "${Q2_NS}"
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: "${Q2_SA}-reader"
subjects:
  - kind: ServiceAccount
    name: "${Q2_SA}"
    namespace: "${Q2_NS}"
EOF
```

### Question 3: Frontend cannot reach ${Q3_APP}

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=dns-egress-port -->
#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=dns-namespace-selector -->
#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-port -->
#### Ingress allowed on the wrong port (`ingress-port`)

`${Q3_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-from-label -->
#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q3_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=egress-to-label -->
#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=${Q3_APP}-v2`, which do not exist, so the client's own egress is dropped even though `${Q3_APP}-ingress` would accept it. Select `app=${Q3_APP}`.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"'"${Q3_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=egress-port -->
#### Frontend egress allowed on the wrong port (`egress-port`)

`frontend-egress` lets frontends connect to the `${Q3_APP}` Pods on port 8080 only, but nginx listens on 80, so the client's connection is dropped on its own side even though `${Q3_APP}-ingress` would accept it. Set the egress port to 80.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-namespace-and -->
#### Ingress peer ANDs a namespace selector (`ingress-namespace-and`)

In `${Q3_APP}-ingress`, the `from` entry holds a `namespaceSelector` (`team=frontend`) and a `podSelector` in the **same** list item, so a peer must match both. No namespace is labelled `team=frontend`, so nothing is allowed in. `kubectl describe networkpolicy` shows it as one peer. Drop the namespaceSelector, so only Pods labelled `role=frontend` in `${Q3_NS}` are allowed.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"podSelector":{"matchLabels":{"role":"frontend"}}}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-pod-selector -->
#### Ingress policy selects no Pod (`ingress-pod-selector`)

`${Q3_APP}-ingress` applies to Pods labelled `app=${Q3_APP}-v2`, which do not exist. Its allow rule protects nothing, and `default-deny` keeps dropping all ingress to the real `${Q3_APP}` Pods. Set its podSelector to `app=${Q3_APP}`.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"'"${Q3_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=dns-policy-deleted -->
#### DNS egress NetworkPolicy was deleted (`dns-policy-deleted`)

NetworkPolicy `allow-dns` is missing, so `default-deny` drops every DNS query: `nslookup` times out and `wget http://${Q3_APP}` fails with `bad address`. Recreate `allow-dns` so every Pod can reach `kube-dns` in `kube-system` on port 53 UDP and TCP.

```bash
kubectl -n "${Q3_NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"allow-dns"},"spec":{"podSelector":{},"policyTypes":["Egress"],"egress":[{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"kube-system"}},"podSelector":{"matchLabels":{"k8s-app":"kube-dns"}}}],"ports":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=dns-udp-only -->
#### DNS egress allows TCP only, not UDP (`dns-udp-only`)

`allow-dns` opens only TCP/53. Cluster DNS queries use UDP first, so names do not resolve (`nslookup` hangs) while wget to a Pod IP still works. Allow both UDP and TCP on port 53.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=dns-pod-selector -->
#### DNS egress selects DNS Pods by the wrong label (`dns-pod-selector`)

`allow-dns` selects Pods labelled `k8s-app=coredns`, but CoreDNS Pods carry `k8s-app=kube-dns` (`kubectl -n kube-system get pods --show-labels`). No peer matches, so DNS is dropped. Select `k8s-app: kube-dns`.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"k8s-app":"kube-dns"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=frontend-egress-deleted -->
#### Frontend egress NetworkPolicy was deleted (`frontend-egress-deleted`)

NetworkPolicy `frontend-egress` is missing, so `default-deny` drops the client's egress to `${Q3_APP}` even though DNS works and `${Q3_APP}-ingress` would accept the connection. Recreate `frontend-egress` so Pods labelled `role=frontend` can reach `app=${Q3_APP}` on TCP port 80.

```bash
kubectl -n "${Q3_NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"frontend-egress"},"spec":{"podSelector":{"matchLabels":{"role":"frontend"}},"policyTypes":["Egress"],"egress":[{"to":[{"podSelector":{"matchLabels":{"app":"'"${Q3_APP}"'"}}}],"ports":[{"protocol":"TCP","port":80}]}]}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=frontend-egress-selector -->
#### Frontend egress policy selects no Pod (`frontend-egress-selector`)

`frontend-egress` applies to Pods labelled `role=front-end`, but `client` is `role=frontend`. The allow rule protects nobody, and `default-deny` drops the client's egress. Set its podSelector to `role=frontend`.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=ingress-ports-cleared -->
#### Ingress allowed on HTTPS only (`ingress-ports-cleared`)

`${Q3_APP}-ingress` lets frontends in on port 443 only, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the ingress port back to 80.

```bash
kubectl -n "${Q3_NS}" patch networkpolicy "${Q3_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports","value":[{"protocol":"TCP","port":80}]}]'
```
<!-- /fault -->
