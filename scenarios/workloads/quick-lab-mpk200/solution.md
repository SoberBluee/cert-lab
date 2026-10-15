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

### Question 2: Service ${Q2_APP} unreachable

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=selector-mismatch -->
#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=${Q2_APP}-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=${Q2_APP}`.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" -p '{"spec":{"selector":{"app":"'"${Q2_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q2_FAULT=target-port -->
#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=named-port -->
#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=network-policy -->
#### NetworkPolicy blocks the traffic (`network-policy`)

NetworkPolicy `${Q2_APP}-ingress` only lets in Pods labelled `role=monitoring`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.

```bash
kubectl -n "${Q2_NS}" delete networkpolicy "${Q2_APP}-ingress"
```
<!-- /fault -->

<!-- fault Q2_FAULT=not-ready -->
#### Readiness probe fails, so there are no ready endpoints (`not-ready`)

The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q2_FAULT=selector-extra-label -->
#### Service selector requires an extra label (`selector-extra-label`)

The Service selects `app=${Q2_APP}` **and** `tier=web`. The Pods carry only `app=${Q2_APP}`, so nothing matches and the Service has no endpoints (`kubectl -n ${Q2_NS} get endpointslices -l kubernetes.io/service-name=${Q2_APP}`). Remove `tier` from the selector.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=service-port -->
#### Service listens on the wrong port (`service-port`)

The Service listens on port `8080`, so `http://${Q2_APP}` (port 80) is refused even though the endpoints are fine. `kubectl -n ${Q2_NS} get svc ${Q2_APP}` shows `8080/TCP`: set `port` back to `80`.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=service-protocol -->
#### Service port uses UDP (`service-protocol`)

The Service port is `80/UDP`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. `kubectl -n ${Q2_NS} get svc ${Q2_APP}` shows the protocol: set it back to `TCP`.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=kube-proxy-down -->
#### kube-proxy runs on no node (`kube-proxy-down`)

Service, endpoints and Pods all look right, and the client can reach a Pod IP directly, but not the Service IP. The `kube-system/kube-proxy` DaemonSet has a nodeSelector `kube-proxy=disabled` that no node matches, so no kube-proxy runs and the Service's new endpoints are never programmed into iptables (`kubectl -n kube-system get ds kube-proxy` shows 0 desired). Remove that nodeSelector entry.

```bash
kubectl -n kube-system patch daemonset kube-proxy --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector/kube-proxy"}]'
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

### Question 3: CronJob ${Q3_APP} never succeeds

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=suspended -->
#### CronJob suspended (`suspended`)

The CronJob has `suspend: true`, so it never creates a Job: `kubectl get cronjob` shows `SUSPEND True` and no `LAST SCHEDULE`. Set `suspend: false`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=merge -p '{"spec":{"suspend":false}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=never-schedule -->
#### Schedule that never fires (`never-schedule`)

The schedule is `0 0 31 2 *`: midnight on February 31st, a date that never comes. It is valid cron syntax, so the API accepts it, but no Job is ever created. Set it back to `* * * * *`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=merge -p '{"spec":{"schedule":"* * * * *"}}'
```
<!-- /fault -->

<!-- fault Q3_FAULT=deadline -->
#### Job time limit shorter than the work (`deadline`)

Each Job has `activeDeadlineSeconds: 3`, but the command sleeps 8 seconds, so every Job is killed and marked failed with reason `DeadlineExceeded` (`kubectl describe job`). Remove the deadline.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/activeDeadlineSeconds"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=backoff-zero-command -->
#### Job command fails and is never retried (`backoff-zero-command`)

The command runs `ech` instead of `echo`, so the container exits with code 127 (`kubectl logs` shows `sh: ech: not found`), and `backoffLimit: 0` fails the Job on the first error. Fix the command and set `backoffLimit` back to `2`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/backoffLimit","value":2},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/command/2","value":"date; sleep 8; echo report done"}]'
```
<!-- /fault -->

<!-- fault Q3_FAULT=image-registry -->
#### Image from a registry that does not exist (`image-registry`)

The image is `registry.invalid/busybox:1.36`, a registry host that does not resolve. The Jobs are created, but their Pods sit in `ErrImagePull` / `ImagePullBackOff` and never finish. Set the image back to `busybox:1.36`; the stuck Jobs can be deleted.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/image","value":"busybox:1.36"}]'
```
<!-- /fault -->
