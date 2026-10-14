## Solution

### Question 1: Deployment ${Q1_APP} does not serve its page

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=configmap-volume-missing -->
#### Volume names a ConfigMap that does not exist (`configmap-volume-missing`)

The `content` volume refers to ConfigMap `${Q1_APP}-contents`, which does not exist, so the Pods stay in `ContainerCreating` and the Events show `FailedMount ... configmap "${Q1_APP}-contents" not found`. Point the volume back at `${Q1_APP}-content`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"'"${Q1_APP}"'-content"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=secret-items-key -->
#### Secret volume asks for a key the Secret does not have (`secret-items-key`)

The `secret` volume projects key `api-token`, but Secret `${Q1_APP}-secret` only has `token`. The mount fails (`references non-existent secret key: api-token` in the Events) and the Pods stay in `ContainerCreating`. Set the item key back to `token`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/1/secret/items/0/key","value":"token"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=mount-path -->
#### ConfigMap mounted one directory too high (`mount-path`)

The ConfigMap is mounted at `/usr/share/nginx`, which hides the `html` directory nginx serves from. nginx runs, but `/` returns 404, so the readiness probe fails and the Pods stay `0/1`. `kubectl exec` and `ls /usr/share/nginx` show `index.html` in the wrong place. Mount it at `/usr/share/nginx/html`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/volumeMounts/0/mountPath","value":"/usr/share/nginx/html"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=run-as-non-root -->
#### runAsNonRoot on an image that runs as root (`run-as-non-root`)

The container sets `runAsNonRoot: true`, but the nginx image starts as root, so the kubelet refuses to start it: `CreateContainerConfigError` with `container has runAsNonRoot and image will run as root`. Remove the securityContext (or run an image built for a non-root user).

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=readonly-root -->
#### Read-only root filesystem (`readonly-root`)

The container sets `readOnlyRootFilesystem: true`. nginx needs to write its cache and pid files, so it exits at startup and the Pods go into `CrashLoopBackOff`; `kubectl logs --previous` shows `Read-only file system`. Remove the securityContext, or mount writable `emptyDir` volumes where nginx writes.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

### Question 2: Frontend cannot reach ${Q2_APP}

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=dns-egress-port -->
#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=dns-namespace-selector -->
#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-port -->
#### Ingress allowed on the wrong port (`ingress-port`)

`${Q2_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "${Q2_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-from-label -->
#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q2_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "${Q2_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=egress-to-label -->
#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=${Q2_APP}-v2`, which do not exist, so the client's own egress is dropped even though `${Q2_APP}-ingress` would accept it. Select `app=${Q2_APP}`.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"'"${Q2_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=egress-port -->
#### Frontend egress allowed on the wrong port (`egress-port`)

`frontend-egress` lets frontends connect to the `${Q2_APP}` Pods on port 8080 only, but nginx listens on 80, so the client's connection is dropped on its own side even though `${Q2_APP}-ingress` would accept it. Set the egress port to 80.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-namespace-and -->
#### Ingress peer ANDs a namespace selector (`ingress-namespace-and`)

In `${Q2_APP}-ingress`, the `from` entry holds a `namespaceSelector` (`team=frontend`) and a `podSelector` in the **same** list item, so a peer must match both. No namespace is labelled `team=frontend`, so nothing is allowed in. `kubectl describe networkpolicy` shows it as one peer. Drop the namespaceSelector, so only Pods labelled `role=frontend` in `${Q2_NS}` are allowed.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "${Q2_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"podSelector":{"matchLabels":{"role":"frontend"}}}}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=ingress-pod-selector -->
#### Ingress policy selects no Pod (`ingress-pod-selector`)

`${Q2_APP}-ingress` applies to Pods labelled `app=${Q2_APP}-v2`, which do not exist. Its allow rule protects nothing, and `default-deny` keeps dropping all ingress to the real `${Q2_APP}` Pods. Set its podSelector to `app=${Q2_APP}`.

```bash
kubectl -n "${Q2_NS}" patch networkpolicy "${Q2_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"'"${Q2_APP}"'"}}]'
```
<!-- /fault -->
