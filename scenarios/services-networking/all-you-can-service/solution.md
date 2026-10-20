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

### Question 2: Service ${Q2_APP} unreachable

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=target-port -->
#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

### Question 3: Service ${Q3_APP} unreachable

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=named-port -->
#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```
<!-- /fault -->

### Question 4: Service ${Q4_APP} unreachable

This run's fault: **`${Q4_FAULT}`**.

<!-- fault Q4_FAULT=service-externalname -->
#### Service type flipped to ExternalName (`service-externalname`)

Service `${Q4_APP}` was changed to `type: ExternalName` pointing at `nowhere.invalid`, so it no longer has a ClusterIP or selectors even though the Deployment looks fine. Recreate (or patch) it as a ClusterIP Service selecting `app=${Q4_APP}` with port `80` → named target port `http`.

```bash
kubectl -n "${Q4_NS}" delete service "${Q4_APP}" --wait=true
kubectl -n "${Q4_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${Q4_APP}"'","namespace":"'"${Q4_NS}"'"},"spec":{"selector":{"app":"'"${Q4_APP}"'"},"ports":[{"port":80,"targetPort":"http"}]}}'
```
<!-- /fault -->

### Question 5: Service ${Q5_APP} unreachable

This run's fault: **`${Q5_FAULT}`**.

<!-- fault Q5_FAULT=egress-network-policy -->
#### NetworkPolicy denies all egress from the namespace (`egress-network-policy`)

NetworkPolicy `deny-egress` selects every Pod and lists `Egress` with no allow rules, so the client cannot leave the Pod network (DNS and HTTP both fail) even though the Service and endpoints look fine. Delete `deny-egress`.

```bash
kubectl -n "${Q5_NS}" delete networkpolicy deny-egress
```
<!-- /fault -->

### Question 6: Service ${Q6_APP} unreachable

This run's fault: **`${Q6_FAULT}`**.

<!-- fault Q6_FAULT=readiness-port-number -->
#### Readiness probe hits the wrong port (`readiness-port-number`)

The readiness probe targets port `8080`, where nothing listens, so the Pods never become ready and the Service has no ready endpoints. Point the probe back at the named port `http`.

```bash
kubectl -n "${Q6_NS}" patch deployment "${Q6_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q6_NS}" rollout status "deployment/${Q6_APP}" --timeout=240s
```
<!-- /fault -->

### Question 7: Service ${Q7_APP} unreachable

This run's fault: **`${Q7_FAULT}`**.

<!-- fault Q7_FAULT=service-port -->
#### Service listens on the wrong port (`service-port`)

The Service listens on port `8080`, so `http://${Q7_APP}` (port 80) is refused even though the endpoints are fine. `kubectl -n ${Q7_NS} get svc ${Q7_APP}` shows `8080/TCP`: set `port` back to `80`.

```bash
kubectl -n "${Q7_NS}" patch service "${Q7_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'
```
<!-- /fault -->

### Question 8: Service ${Q8_APP} unreachable

This run's fault: **`${Q8_FAULT}`**.

<!-- fault Q8_FAULT=readiness-https -->
#### Readiness probe uses HTTPS against plain HTTP (`readiness-https`)

The readiness probe uses `scheme: HTTPS`, but nginx serves plain HTTP on port 80, so every probe fails and the Service has only not-ready endpoints. The Pods stay `Running` with `RESTARTS 0` and no crash logs — readiness failures only withdraw endpoints, they never restart the container (that is liveness). `kubectl describe pod` shows the `Unhealthy` readiness events. Remove the scheme (or set it to `HTTP`) so the probe succeeds.

```bash
kubectl -n "${Q8_NS}" patch deployment "${Q8_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme"}]'
kubectl -n "${Q8_NS}" rollout status "deployment/${Q8_APP}" --timeout=240s
```
<!-- /fault -->

### Question 9: Service ${Q9_APP} unreachable

This run's fault: **`${Q9_FAULT}`**.

<!-- fault Q9_FAULT=kube-proxy-down -->
#### kube-proxy runs on no node (`kube-proxy-down`)

Service, endpoints and Pods all look right, and the client can reach a Pod IP directly, but not the Service IP. The `kube-system/kube-proxy` DaemonSet has a nodeSelector `kube-proxy=disabled` that no node matches, so no kube-proxy runs and the Service's new endpoints are never programmed into iptables (`kubectl -n kube-system get ds kube-proxy` shows 0 desired). An unmatched nodeSelector is not an error, so there are no Pods, events or logs to find — `DESIRED 0` on the DaemonSet plus a clean namespace is the whole signal. Remove that nodeSelector entry.

```bash
kubectl -n kube-system patch daemonset kube-proxy --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector/kube-proxy"}]'
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->
