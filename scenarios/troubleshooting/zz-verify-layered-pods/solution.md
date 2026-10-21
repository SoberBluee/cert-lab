## Solution

### Question 1: Unhealthy Deployment storefront

**The healthy setup**

- `2` replicas of image `nginx:1.27-alpine`, container `web` listening on port `80`
- requests `50m` CPU and `32Mi` memory; limits `250m` CPU and `128Mi` memory
- a readiness probe doing an HTTP GET of `/` on port `80`, and a liveness probe opening a TCP connection to port `80`
- the environment variable `APP_MODE` taken from key `mode` of ConfigMap `storefront-config`, whose value is `production`
- no nodeSelector or affinity, and a normal RollingUpdate strategy, not paused

This run broke 3 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**, **`${Q1_FAULT_3}`**. Fix them in the order below.

**Problem 1: the container**

<!-- fault Q1_FAULT=oom-killed -->
#### Memory limit too low (OOMKilled) (`oom-killed`)

The memory limit was lowered to 4Mi, so the container is killed as soon as it starts: `describe pod` shows `OOMKilled` (or a start error) and the restart count climbs. Put the requests and limits back to the spec.

```bash
kubectl -n "retail" set resources "deployment/storefront" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
```
<!-- /fault -->

<!-- fault Q1_FAULT=image-pull -->
#### Image tag does not exist (ImagePullBackOff) (`image-pull`)

The image was changed to `nginx:1.27-alpne`, which does not exist: the Pods sit in `ErrImagePull` / `ImagePullBackOff`. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "retail" set image "deployment/storefront" web=nginx:1.27-alpine
```
<!-- /fault -->

<!-- fault Q1_FAULT=bad-command -->
#### Broken command (CrashLoopBackOff) (`bad-command`)

A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.

```bash
kubectl -n "retail" patch deployment "storefront" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=busybox-bash -->
#### Command uses /bin/bash on an image without it (`busybox-bash`)

The container `command` starts with `/bin/bash`, which this alpine-based image does not ship. Events show `exec: "/bin/bash": no such file` and the Pods CrashLoop. Remove the command override (or use `/bin/sh`) so nginx starts again.

```bash
kubectl -n "retail" patch deployment "storefront" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=configmap-key -->
#### ConfigMap key missing (CreateContainerConfigError) (`configmap-key`)

ConfigMap `storefront-config` has the key `mod` instead of `mode`, so the containers cannot be created: `CreateContainerConfigError`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.

```bash
kubectl -n "retail" patch configmap "storefront-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "retail" rollout restart "deployment/storefront"
```
<!-- /fault -->

**Problem 2: the probes**

<!-- fault Q1_FAULT_2=liveness-port -->
#### Liveness probe on the wrong port (`liveness-port`)

The liveness probe checks port 8080, where nothing listens, so the kubelet keeps killing healthy containers: the restart count climbs and the Events show `Liveness probe failed`. Point the probe back at port 80.

```bash
kubectl -n "retail" patch deployment "storefront" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"tcpSocket":{"port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=readiness-path -->
#### Readiness probe on the wrong path (`readiness-path`)

The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.

```bash
kubectl -n "retail" patch deployment "storefront" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'
```
<!-- /fault -->

**Problem 3: scheduling**

<!-- fault Q1_FAULT_3=requests-too-large -->
#### CPU request larger than any node (Pending) (`requests-too-large`)

The CPU request was raised to 64 cores, so no node can fit a Pod: they stay `Pending` with `Insufficient cpu` in the Events. Put the requests and limits back to the spec.

```bash
kubectl -n "retail" set resources "deployment/storefront" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=node-selector -->
#### nodeSelector matching no node (Pending) (`node-selector`)

A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.

```bash
kubectl -n "retail" patch deployment "storefront" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
```
<!-- /fault -->
