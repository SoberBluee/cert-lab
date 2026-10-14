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
