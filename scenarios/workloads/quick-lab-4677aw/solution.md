## Solution

### Question 1: Autoscaler ${Q1_APP} not working

**The healthy setup**

- the autoscaler targets Deployment `${Q1_APP}`, between `2` and `6` replicas, at `50%` average CPU utilization
- Deployment `${Q1_APP}` runs image `nginx:1.27-alpine`, container `web`, requesting `50m` CPU and `32Mi` memory
- metrics-server runs in `kube-system`, and APIService `v1beta1.metrics.k8s.io` is available

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=no-cpu-request -->
#### Deployment has no CPU request (`no-cpu-request`)

Utilization is measured against the container's CPU request, and `web` has none, so the autoscaler reports "missing request for cpu" (FailedGetResourceMetric) and its target stays `<unknown>`. Set the request back to `50m`: `kubectl -n ${Q1_NS} set resources deployment ${Q1_APP} -c web --requests=cpu=50m,memory=32Mi`.

```bash
kubectl -n "${Q1_NS}" set resources "deployment/${Q1_APP}" -c web --requests=cpu=50m,memory=32Mi
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-name -->
#### Autoscaler targets a missing Deployment (`target-name`)

`scaleTargetRef.name` is `${Q1_APP}-v2`, which does not exist, so the autoscaler fails with FailedGetScale and never scales `${Q1_APP}`. Point it back at Deployment `${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch hpa "${Q1_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"name":"'"${Q1_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-kind -->
#### Autoscaler targets the wrong kind (`target-kind`)

`scaleTargetRef.kind` is `StatefulSet`, and there is no StatefulSet `${Q1_APP}`, so the autoscaler fails with FailedGetScale. Set the kind back to `Deployment`.

```bash
kubectl -n "${Q1_NS}" patch hpa "${Q1_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"kind":"Deployment"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=max-one -->
#### Replica range pinned to one (`max-one`)

The autoscaler's range is `1`-`1`, so it scaled `${Q1_APP}` down to a single replica and can never add more (ScalingLimited). Scaling the Deployment by hand does not help: the autoscaler overrides it. Restore `minReplicas: 2` and `maxReplicas: 6`.

```bash
kubectl -n "${Q1_NS}" patch hpa "${Q1_APP}" --type=merge -p '{"spec":{"minReplicas":2,"maxReplicas":6}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=metrics-server-down -->
#### metrics-server scaled to zero (`metrics-server-down`)

The `kube-system/metrics-server` Deployment has `0` replicas, so the `v1beta1.metrics.k8s.io` APIService is unavailable, `kubectl top` fails, and every autoscaler shows `<unknown>` targets. Scale it back to `1` replica.

```bash
kubectl -n kube-system scale deployment/metrics-server --replicas=1
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done
```
<!-- /fault -->

<!-- fault Q1_FAULT=metrics-apiservice -->
#### metrics-server Service points at the wrong port (`metrics-apiservice`)

metrics-server itself runs, but its Service sends traffic to port `8443`, where nothing listens. The `v1beta1.metrics.k8s.io` APIService behind that Service is unavailable (`kubectl get apiservice v1beta1.metrics.k8s.io` shows FailedDiscoveryCheck), so `kubectl top` and every autoscaler fail. Set the Service's `targetPort` back to the container's port (named `https`).

```bash
port="$(kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].ports[0].name}')"
kubectl -n kube-system patch service metrics-server --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/ports/0/targetPort\",\"value\":\"$port\"}]"
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done
```
<!-- /fault -->

### Question 2: Autoscaler ${Q2_APP} not working

**The healthy setup**

- the autoscaler targets Deployment `${Q2_APP}`, between `2` and `6` replicas, at `50%` average CPU utilization
- Deployment `${Q2_APP}` runs image `nginx:1.27-alpine`, container `web`, requesting `50m` CPU and `32Mi` memory
- metrics-server runs in `kube-system`, and APIService `v1beta1.metrics.k8s.io` is available

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=no-cpu-request -->
#### Deployment has no CPU request (`no-cpu-request`)

Utilization is measured against the container's CPU request, and `web` has none, so the autoscaler reports "missing request for cpu" (FailedGetResourceMetric) and its target stays `<unknown>`. Set the request back to `50m`: `kubectl -n ${Q2_NS} set resources deployment ${Q2_APP} -c web --requests=cpu=50m,memory=32Mi`.

```bash
kubectl -n "${Q2_NS}" set resources "deployment/${Q2_APP}" -c web --requests=cpu=50m,memory=32Mi
```
<!-- /fault -->

<!-- fault Q2_FAULT=target-name -->
#### Autoscaler targets a missing Deployment (`target-name`)

`scaleTargetRef.name` is `${Q2_APP}-v2`, which does not exist, so the autoscaler fails with FailedGetScale and never scales `${Q2_APP}`. Point it back at Deployment `${Q2_APP}`.

```bash
kubectl -n "${Q2_NS}" patch hpa "${Q2_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"name":"'"${Q2_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q2_FAULT=target-kind -->
#### Autoscaler targets the wrong kind (`target-kind`)

`scaleTargetRef.kind` is `StatefulSet`, and there is no StatefulSet `${Q2_APP}`, so the autoscaler fails with FailedGetScale. Set the kind back to `Deployment`.

```bash
kubectl -n "${Q2_NS}" patch hpa "${Q2_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"kind":"Deployment"}}}'
```
<!-- /fault -->

<!-- fault Q2_FAULT=max-one -->
#### Replica range pinned to one (`max-one`)

The autoscaler's range is `1`-`1`, so it scaled `${Q2_APP}` down to a single replica and can never add more (ScalingLimited). Scaling the Deployment by hand does not help: the autoscaler overrides it. Restore `minReplicas: 2` and `maxReplicas: 6`.

```bash
kubectl -n "${Q2_NS}" patch hpa "${Q2_APP}" --type=merge -p '{"spec":{"minReplicas":2,"maxReplicas":6}}'
```
<!-- /fault -->

<!-- fault Q2_FAULT=metrics-server-down -->
#### metrics-server scaled to zero (`metrics-server-down`)

The `kube-system/metrics-server` Deployment has `0` replicas, so the `v1beta1.metrics.k8s.io` APIService is unavailable, `kubectl top` fails, and every autoscaler shows `<unknown>` targets. Scale it back to `1` replica.

```bash
kubectl -n kube-system scale deployment/metrics-server --replicas=1
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done
```
<!-- /fault -->

<!-- fault Q2_FAULT=metrics-apiservice -->
#### metrics-server Service points at the wrong port (`metrics-apiservice`)

metrics-server itself runs, but its Service sends traffic to port `8443`, where nothing listens. The `v1beta1.metrics.k8s.io` APIService behind that Service is unavailable (`kubectl get apiservice v1beta1.metrics.k8s.io` shows FailedDiscoveryCheck), so `kubectl top` and every autoscaler fail. Set the Service's `targetPort` back to the container's port (named `https`).

```bash
port="$(kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].ports[0].name}')"
kubectl -n kube-system patch service metrics-server --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/ports/0/targetPort\",\"value\":\"$port\"}]"
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done
```
<!-- /fault -->
