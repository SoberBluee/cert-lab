## Solution

### Question 1: CronJob ${Q1_APP} never succeeds

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=suspended -->
#### CronJob suspended (`suspended`)

The CronJob has `suspend: true`, so it never creates a Job: `kubectl get cronjob` shows `SUSPEND True` and no `LAST SCHEDULE`. Set `suspend: false`.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=merge -p '{"spec":{"suspend":false}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=never-schedule -->
#### Schedule that never fires (`never-schedule`)

The schedule is `0 0 31 2 *`: midnight on February 31st, a date that never comes. It is valid cron syntax, so the API accepts it, but no Job is ever created. Set it back to `* * * * *`.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=merge -p '{"spec":{"schedule":"* * * * *"}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=deadline -->
#### Job time limit shorter than the work (`deadline`)

Each Job has `activeDeadlineSeconds: 3`, but the command sleeps 8 seconds, so every Job is killed and marked failed with reason `DeadlineExceeded` (`kubectl describe job`). Remove the deadline.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/activeDeadlineSeconds"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=backoff-zero-command -->
#### Job command fails and is never retried (`backoff-zero-command`)

The command runs `ech` instead of `echo`, so the container exits with code 127 (`kubectl logs` shows `sh: ech: not found`), and `backoffLimit: 0` fails the Job on the first error. Fix the command and set `backoffLimit` back to `2`.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/backoffLimit","value":2},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/command/2","value":"date; sleep 8; echo report done"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=image-registry -->
#### Image from a registry that does not exist (`image-registry`)

The image is `registry.invalid/busybox:1.36`, a registry host that does not resolve. The Jobs are created, but their Pods sit in `ErrImagePull` / `ImagePullBackOff` and never finish. Set the image back to `busybox:1.36`; the stuck Jobs can be deleted.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/image","value":"busybox:1.36"}]'
```
<!-- /fault -->

### Question 2: Unhealthy Deployment ${Q2_APP}

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=oom-killed -->
#### Memory limit too low (OOMKilled) (`oom-killed`)

The memory limit was lowered to 4Mi, so the container is killed as soon as it starts: `describe pod` shows `OOMKilled` (or a start error) and the restart count climbs. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q2_NS}" set resources "deployment/${Q2_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=image-pull -->
#### Image tag does not exist (ImagePullBackOff) (`image-pull`)

The image was changed to `nginx:1.27-alpne`, which does not exist: the Pods sit in `ErrImagePull` / `ImagePullBackOff`. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q2_NS}" set image "deployment/${Q2_APP}" web=nginx:1.27-alpine
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=bad-command -->
#### Broken command (CrashLoopBackOff) (`bad-command`)

A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=configmap-key -->
#### ConfigMap key missing (CreateContainerConfigError) (`configmap-key`)

ConfigMap `${Q2_APP}-config` has the key `mod` instead of `mode`, so the containers cannot be created: `CreateContainerConfigError`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.

```bash
kubectl -n "${Q2_NS}" patch configmap "${Q2_APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=liveness-port -->
#### Liveness probe on the wrong port (`liveness-port`)

The liveness probe checks port 8080, where nothing listens, so the kubelet keeps killing healthy containers: the restart count climbs and the Events show `Liveness probe failed`. Point the probe back at port 80.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"tcpSocket":{"port":80}}}]}}}}'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=readiness-path -->
#### Readiness probe on the wrong path (`readiness-path`)

The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=requests-too-large -->
#### CPU request larger than any node (Pending) (`requests-too-large`)

The CPU request was raised to 64 cores, so no node can fit a Pod: they stay `Pending` with `Insufficient cpu` in the Events. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q2_NS}" set resources "deployment/${Q2_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=node-selector -->
#### nodeSelector matching no node (Pending) (`node-selector`)

A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

### Question 3: Autoscaler ${Q3_APP} not working

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=no-cpu-request -->
#### Deployment has no CPU request (`no-cpu-request`)

Utilization is measured against the container's CPU request, and `web` has none, so the autoscaler reports "missing request for cpu" (FailedGetResourceMetric) and its target stays `<unknown>`. Set the request back to `50m`: `kubectl -n ${Q3_NS} set resources deployment ${Q3_APP} -c web --requests=cpu=50m,memory=32Mi`.

```bash
kubectl -n "${Q3_NS}" set resources "deployment/${Q3_APP}" -c web --requests=cpu=50m,memory=32Mi
```
<!-- /fault -->

<!-- fault Q3_FAULT=target-name -->
#### Autoscaler targets a missing Deployment (`target-name`)

`scaleTargetRef.name` is `${Q3_APP}-v2`, which does not exist, so the autoscaler fails with FailedGetScale and never scales `${Q3_APP}`. Point it back at Deployment `${Q3_APP}`.

```bash
kubectl -n "${Q3_NS}" patch hpa "${Q3_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"name":"'"${Q3_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=target-kind -->
#### Autoscaler targets the wrong kind (`target-kind`)

`scaleTargetRef.kind` is `StatefulSet`, and there is no StatefulSet `${Q3_APP}`, so the autoscaler fails with FailedGetScale. Set the kind back to `Deployment`.

```bash
kubectl -n "${Q3_NS}" patch hpa "${Q3_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"kind":"Deployment"}}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=max-one -->
#### Replica range pinned to one (`max-one`)

The autoscaler's range is `1`-`1`, so it scaled `${Q3_APP}` down to a single replica and can never add more (ScalingLimited). Scaling the Deployment by hand does not help: the autoscaler overrides it. Restore `minReplicas: 2` and `maxReplicas: 6`.

```bash
kubectl -n "${Q3_NS}" patch hpa "${Q3_APP}" --type=merge -p '{"spec":{"minReplicas":2,"maxReplicas":6}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=metrics-server-down -->
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

<!-- fault Q3_FAULT=metrics-apiservice -->
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
