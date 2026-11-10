## Solution

### Question 1: DaemonSet ${Q1_DS} is not running everywhere

**The healthy setup**

- container `agent`: image `nginx:1.27-alpine` on port `80`, a readiness probe doing an HTTP GET of `/` on port `80`, requests `10m` CPU and `16Mi` memory
- a toleration for the control plane's `node-role.kubernetes.io/control-plane:NoSchedule` taint, and no nodeSelector, affinity or host port
- update strategy `RollingUpdate` with `maxUnavailable: 1`
- no worker tainted, and any other DaemonSet of the namespace left as it is

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=image-typo -->
#### Image tag does not exist (ImagePullBackOff) (`image-typo`)

The image is `nginx:1.27-apline`, a tag that does not exist: every Pod sits in `ErrImagePull` / `ImagePullBackOff`, and `kubectl describe pod` names the tag it failed to pull. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q1_NS}" set image "daemonset/${Q1_DS}" agent=nginx:1.27-alpine
```
<!-- /fault -->

<!-- fault Q1_FAULT=readiness-port -->
#### Readiness probe on a port nothing listens on (`readiness-port`)

The readiness probe asks port `8080`, where nothing listens: the Pods run but are never ready (`0/1`), and their Events show `Readiness probe failed: ... connection refused`. Point the probe at port `80`, where nginx listens.

```bash
kubectl -n "${Q1_NS}" patch daemonset "${Q1_DS}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"agent","readinessProbe":{"httpGet":{"port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=cp-toleration-typo -->
#### Toleration misses the control plane's taint (`cp-toleration-typo`)

The toleration's key is `node-role.kubernetes.io/controlplane`, but the control plane's taint is `node-role.kubernetes.io/control-plane:NoSchedule` (`kubectl describe node controlplane | grep Taints`). It tolerates nothing, so the DaemonSet targets the workers only: DESIRED is one less than the number of nodes, and no Pod runs on `controlplane`. Fix the key; removing the taint instead would open the control plane to every Pod.

```bash
kubectl -n "${Q1_NS}" patch daemonset "${Q1_DS}" --type=strategic -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"node-role.kubernetes.io/control-plane","operator":"Exists","effect":"NoSchedule"}]}}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=hostname-affinity -->
#### Node affinity pinned to a list of node names (`hostname-affinity`)

A required node affinity allows only the nodes whose `kubernetes.io/hostname` is `controlplane` or the other worker, as if the DaemonSet had been written for the nodes that existed back then: `${Q1_WORKER}` gets no Pod, and DESIRED is one less than the number of nodes. `kubectl -n ${Q1_NS} get pods -l app=${Q1_DS} -o wide` shows which node is missing. A DaemonSet that runs everywhere needs no affinity: remove it.

```bash
kubectl -n "${Q1_NS}" patch daemonset "${Q1_DS}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=hostport-conflict -->
#### Host port already taken by another DaemonSet (`hostport-conflict`)

The container port asks for a host port on every node, but DaemonSet `legacy-exporter` in the same namespace already holds that port on the workers. The Pods there stay `Pending` with "didn't have free ports for the requested pod ports"; only `controlplane`, where the exporter does not run, gets one. `kubectl -n ${Q1_NS} get daemonset,pods -o wide` and `kubectl -n ${Q1_NS} get daemonset legacy-exporter -o yaml` show the clash. `${Q1_DS}` needs no host port: remove `hostPort` from its container port, and leave the exporter as it is.

```bash
kubectl -n "${Q1_NS}" patch daemonset "${Q1_DS}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/ports/0/hostPort"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=worker-taint -->
#### A worker kept its maintenance taint (`worker-taint`)

Worker `${Q1_WORKER}` still carries the taint `maintenance=planned:NoSchedule` from a maintenance window (`kubectl describe node ${Q1_WORKER} | grep Taints`). DaemonSet Pods tolerate only the taints Kubernetes itself sets, such as `unschedulable` and `not-ready`, so `${Q1_DS}` targets one node less and `${Q1_WORKER}` has no Pod. The maintenance is over: remove the taint. A toleration in the DaemonSet would also bring its Pod back, but leave the worker closed to every other Pod.

```bash
kubectl taint node "${Q1_WORKER}" maintenance=planned:NoSchedule-
```
<!-- /fault -->

<!-- fault Q1_FAULT=ondelete-stale -->
#### Pods from an older template, never replaced under OnDelete (`ondelete-stale`)

The Pods crash, and `kubectl -n ${Q1_NS} logs <pod>` shows nginx failing to open `/etc/nginx/agent.conf`, yet the DaemonSet's template runs no such command. The Pods were created from an earlier template, and the update strategy is `OnDelete`, so the DaemonSet never replaces them: `kubectl -n ${Q1_NS} get daemonset ${Q1_DS}` shows UP-TO-DATE `0`, and `kubectl -n ${Q1_NS} rollout history daemonset/${Q1_DS}` lists the newer revision. Set the update strategy back to `RollingUpdate` with `maxUnavailable: 1`, and the Pods are replaced from the current template. Deleting the Pods would replace them too, but the next template change would get stuck again.

```bash
kubectl -n "${Q1_NS}" patch daemonset "${Q1_DS}" --type=strategic -p '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"maxUnavailable":1}}}}'
```
<!-- /fault -->
