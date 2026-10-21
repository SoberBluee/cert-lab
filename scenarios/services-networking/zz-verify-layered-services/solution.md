## Solution

### Question 1: Service web unreachable

**The healthy setup**

- Deployment `web`: `2` replicas of `nginx:1.27-alpine` labelled `app=web`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `web`: `ClusterIP`, selecting `app=web`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `store` from reaching `web` on port `80`, and kube-proxy runs on every node
- `web-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run broke 3 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**, **`${Q1_FAULT_3}`**. Fix them in the order below.

**Problem 1: the Service**

<!-- fault Q1_FAULT=selector-mismatch -->
#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=web-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=web`.

```bash
kubectl -n "store" patch service "web" -p '{"spec":{"selector":{"app":"'"web"'"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-port -->
#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "store" patch service "web" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=selector-extra-label -->
#### Service selector requires an extra label (`selector-extra-label`)

The Service selects `app=web` **and** `tier=web`. The Pods carry only `app=web`, so nothing matches and the Service has no endpoints (`kubectl -n store get endpointslices -l kubernetes.io/service-name=web`). Remove `tier` from the selector.

```bash
kubectl -n "store" patch service "web" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-port -->
#### Service listens on the wrong port (`service-port`)

The Service listens on port `8080`, so `http://web` (port 80) is refused even though the endpoints are fine. `kubectl -n store get svc web` shows `8080/TCP`: set `port` back to `80`.

```bash
kubectl -n "store" patch service "web" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-protocol -->
#### Service port uses UDP (`service-protocol`)

The Service port is `80/UDP`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. `kubectl -n store get svc web` shows the protocol: set it back to `TCP`.

```bash
kubectl -n "store" patch service "web" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=selector-cleared -->
#### Service has no selector (`selector-cleared`)

The Service has no `selector`, so it manages no endpoints (`kubectl -n store get endpointslices -l kubernetes.io/service-name=web` is empty). Restore `selector: { app: web }`.

```bash
kubectl -n "store" patch service "web" --type=json -p '[{"op":"add","path":"/spec/selector","value":{"app":"'"web"'"}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-port-typo -->
#### Service targetPort has a typo (`target-port-typo`)

The Service's `targetPort` is `htt`, but the container port is named `http`, so the endpoint slices list no ports and traffic goes nowhere. Set `targetPort` back to `http`.

```bash
kubectl -n "store" patch service "web" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-externalname -->
#### Service type flipped to ExternalName (`service-externalname`)

Service `web` was changed to `type: ExternalName` pointing at `nowhere.invalid`, so it no longer has a ClusterIP or selectors even though the Deployment looks fine. Recreate (or patch) it as a ClusterIP Service selecting `app=web` with port `80` → named target port `http`.

```bash
kubectl -n "store" delete service "web" --wait=true
kubectl -n "store" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"web"'","namespace":"'"store"'"},"spec":{"selector":{"app":"'"web"'"},"ports":[{"port":80,"targetPort":"http"}]}}'
```
<!-- /fault -->

**Problem 2: the backend Pods**

<!-- fault Q1_FAULT_2=named-port -->
#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "store" patch deployment "web" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "store" rollout status "deployment/web" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=not-ready -->
#### Readiness probe fails, so there are no ready endpoints (`not-ready`)

The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.

```bash
kubectl -n "store" patch deployment "web" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "store" rollout status "deployment/web" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=readiness-https -->
#### Readiness probe uses HTTPS against plain HTTP (`readiness-https`)

The readiness probe uses `scheme: HTTPS`, but nginx serves plain HTTP on port 80, so every probe fails and the Service has only not-ready endpoints. The Pods stay `Running` with `RESTARTS 0` and no crash logs — readiness failures only withdraw endpoints, they never restart the container (that is liveness). `kubectl describe pod` shows the `Unhealthy` readiness events. Remove the scheme (or set it to `HTTP`) so the probe succeeds.

```bash
kubectl -n "store" patch deployment "web" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme"}]'
kubectl -n "store" rollout status "deployment/web" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=readiness-port-number -->
#### Readiness probe hits the wrong port (`readiness-port-number`)

The readiness probe targets port `8080`, where nothing listens, so the Pods never become ready and the Service has no ready endpoints. Point the probe back at the named port `http`.

```bash
kubectl -n "store" patch deployment "web" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "store" rollout status "deployment/web" --timeout=240s
```
<!-- /fault -->

**Problem 3: the network path**

<!-- fault Q1_FAULT_3=network-policy -->
#### NetworkPolicy blocks the traffic (`network-policy`)

NetworkPolicy `web-ingress` only lets in Pods labelled `role=monitoring`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.

```bash
kubectl -n "store" delete networkpolicy "web-ingress"
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=kube-proxy-down -->
#### kube-proxy runs on no node (`kube-proxy-down`)

Service, endpoints and Pods all look right, and the client can reach a Pod IP directly, but not the Service IP. The `kube-system/kube-proxy` DaemonSet has a nodeSelector `kube-proxy=disabled` that no node matches, so no kube-proxy runs and the Service's new endpoints are never programmed into iptables (`kubectl -n kube-system get ds kube-proxy` shows 0 desired). An unmatched nodeSelector is not an error, so there are no Pods, events or logs to find — `DESIRED 0` on the DaemonSet plus a clean namespace is the whole signal. Remove that nodeSelector entry.

```bash
kubectl -n kube-system patch daemonset kube-proxy --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector/kube-proxy"}]'
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=egress-network-policy -->
#### NetworkPolicy denies all egress from the namespace (`egress-network-policy`)

NetworkPolicy `deny-egress` selects every Pod and lists `Egress` with no allow rules, so the client cannot leave the Pod network (DNS and HTTP both fail) even though the Service and endpoints look fine. Delete `deny-egress`.

```bash
kubectl -n "store" delete networkpolicy deny-egress
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=kube-proxy-config-mode -->
#### kube-proxy mode is invalid (`kube-proxy-config-mode`)

ConfigMap `kube-system/kube-proxy` sets `mode: not-a-mode`, so kube-proxy Pods crash-loop and Service ClusterIPs stop working. Set `mode` back to `iptables` (or empty) in the ConfigMap and restart the `kube-proxy` DaemonSet.

```bash
kubectl -n kube-system patch configmap kube-proxy --type merge -p "$(python3 -c 'import json,pathlib; print(json.dumps({"data":{"config.conf": pathlib.Path("/tmp/cka-kube-proxy.conf.bak").read_text()}}))')"
kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->
