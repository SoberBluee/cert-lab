## Solution

### Question 1: Pods of api keep restarting

**The healthy setup**

- `2` replicas of `nginx:1.27-alpine`, container `web` on port `80`, no command override
- requests `50m` CPU and `32Mi` memory; limits `250m` CPU and `128Mi` memory
- readiness and liveness probes doing an HTTP GET of `/` on port `80`, with timing that suits how fast nginx starts

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=liveness-port -->
#### Liveness probe on a port nothing listens on (`liveness-port`)

The liveness probe calls port `8080`, where nothing listens, so every probe fails and the kubelet kills a healthy container about every 10 seconds. `describe pod` shows `Liveness probe failed: ... connection refused` and `Killing`. Point the probe at port `80`.

```bash
kubectl -n "pay" patch deployment "api" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=liveness-path -->
#### Liveness probe on a path that returns 404 (`liveness-path`)

The liveness probe requests `/healthz`, which nginx answers with 404, so the kubelet restarts the container again and again (`Liveness probe failed: HTTP probe failed with statuscode: 404`). The logs show the 404s too. Probe `/`.

```bash
kubectl -n "pay" patch deployment "api" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=liveness-exec -->
#### Exec liveness probe checks a file that never exists (`liveness-exec`)

The liveness probe runs `cat /tmp/healthy`, but nothing in the image ever creates that file, so the probe always fails and the container is killed every few seconds (`Liveness probe failed: cat: can't open '/tmp/healthy'`). Probe something the app really provides, such as an HTTP GET of `/` on port `80`.

```bash
kubectl -n "pay" patch deployment "api" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe","value":{"httpGet":{"path":"/","port":80},"periodSeconds":5,"failureThreshold":2}}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=liveness-early -->
#### Liveness probe gives up before a slow start finishes (`liveness-early`)

The container waits 20 seconds before nginx starts (its command is part of the app and must stay), but the liveness probe starts after 2 seconds and gives up after two failures, so the kubelet kills the container before it ever serves. The logs are empty; `describe pod` shows `Liveness probe failed ... connection refused` and `Killing`. Give it time to start: a `startupProbe` (for example HTTP GET `/`, `periodSeconds: 5`, `failureThreshold: 12`) holds the liveness probe back until the app answers, or raise `initialDelaySeconds` above 20.

```bash
kubectl -n "pay" patch deployment "api" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","startupProbe":{"httpGet":{"path":"/","port":80},"periodSeconds":5,"failureThreshold":12}}]}}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=oom-limit -->
#### Memory limit too low (OOMKilled) (`oom-limit`)

The memory limit is `4Mi`, less than nginx needs to start, so the kernel kills it: `describe pod` shows `Last State: Terminated, Reason: OOMKilled` (exit code 137) and the restart count climbs. Give the container a realistic limit, such as the `128Mi` it had (request `32Mi`).

```bash
kubectl -n "pay" set resources "deployment/api" -c web --requests=memory=32Mi --limits=memory=128Mi
```
<!-- /fault -->
