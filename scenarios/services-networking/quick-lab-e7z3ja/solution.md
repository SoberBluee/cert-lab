## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=selector-mismatch -->
#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=${Q1_APP}-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" -p '{"spec":{"selector":{"app":"'"${Q1_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-port -->
#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=named-port -->
#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=network-policy -->
#### NetworkPolicy blocks the traffic (`network-policy`)

NetworkPolicy `${Q1_APP}-ingress` only lets in Pods labelled `role=monitoring`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.

```bash
kubectl -n "${Q1_NS}" delete networkpolicy "${Q1_APP}-ingress"
```
<!-- /fault -->

<!-- fault Q1_FAULT=not-ready -->
#### Readiness probe fails, so there are no ready endpoints (`not-ready`)

The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=selector-extra-label -->
#### Service selector requires an extra label (`selector-extra-label`)

The Service selects `app=${Q1_APP}` **and** `tier=web`. The Pods carry only `app=${Q1_APP}`, so nothing matches and the Service has no endpoints (`kubectl -n ${Q1_NS} get endpointslices -l kubernetes.io/service-name=${Q1_APP}`). Remove `tier` from the selector.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-port -->
#### Service listens on the wrong port (`service-port`)

The Service listens on port `8080`, so `http://${Q1_APP}` (port 80) is refused even though the endpoints are fine. `kubectl -n ${Q1_NS} get svc ${Q1_APP}` shows `8080/TCP`: set `port` back to `80`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-protocol -->
#### Service port uses UDP (`service-protocol`)

The Service port is `80/UDP`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. `kubectl -n ${Q1_NS} get svc ${Q1_APP}` shows the protocol: set it back to `TCP`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=kube-proxy-down -->
#### kube-proxy runs on no node (`kube-proxy-down`)

Service, endpoints and Pods all look right, and the client can reach a Pod IP directly, but not the Service IP. The `kube-system/kube-proxy` DaemonSet has a nodeSelector `kube-proxy=disabled` that no node matches, so no kube-proxy runs and the Service's new endpoints are never programmed into iptables (`kubectl -n kube-system get ds kube-proxy` shows 0 desired). Remove that nodeSelector entry.

```bash
kubectl -n kube-system patch daemonset kube-proxy --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector/kube-proxy"}]'
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=selector-cleared -->
#### Service has no selector (`selector-cleared`)

The Service has no `selector`, so it manages no endpoints (`kubectl -n ${Q1_NS} get endpointslices -l kubernetes.io/service-name=${Q1_APP}` is empty). Restore `selector: { app: ${Q1_APP} }`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"add","path":"/spec/selector","value":{"app":"'"${Q1_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-port-typo -->
#### Service targetPort has a typo (`target-port-typo`)

The Service's `targetPort` is `htt`, but the container port is named `http`, so the endpoint slices list no ports and traffic goes nowhere. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=pod-label-drift -->
#### Pod labels drifted away from the Service selector (`pod-label-drift`)

The running Pods are labelled `app=${Q1_APP}-v2`, but Service `${Q1_APP}` still selects `app=${Q1_APP}`, so it has no endpoints. The Deployment is paused, which is why the controller did not recreate correctly labelled Pods. Relabel the Pods to `app=${Q1_APP}` and unpause the Deployment (`spec.paused: false`).

```bash
kubectl -n "${Q1_NS}" label pods -l "app=${Q1_APP}-v2" "app=${Q1_APP}" --overwrite
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" -p '{"spec":{"paused":false}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=readiness-https -->
#### Readiness probe uses HTTPS against plain HTTP (`readiness-https`)

The readiness probe uses `scheme: HTTPS`, but nginx serves plain HTTP on port 80, so every probe fails and the Service has only not-ready endpoints. Remove the scheme (or set it to `HTTP`) so the probe succeeds.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=readiness-port-number -->
#### Readiness probe hits the wrong port (`readiness-port-number`)

The readiness probe targets port `8080`, where nothing listens, so the Pods never become ready and the Service has no ready endpoints. Point the probe back at the named port `http`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT=egress-network-policy -->
#### NetworkPolicy denies all egress from the namespace (`egress-network-policy`)

NetworkPolicy `deny-egress` selects every Pod and lists `Egress` with no allow rules, so the client cannot leave the Pod network (DNS and HTTP both fail) even though the Service and endpoints look fine. Delete `deny-egress`.

```bash
kubectl -n "${Q1_NS}" delete networkpolicy deny-egress
```
<!-- /fault -->
