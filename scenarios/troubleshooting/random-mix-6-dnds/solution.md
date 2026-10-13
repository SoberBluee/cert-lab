## Solution

### Question 1: Unhealthy Deployment ${Q1_APP}

This run's fault: **`${Q1_FAULT}`**.

Every fault this question can roll:

#### Memory limit too low (OOMKilled) (`oom-killed`)

The memory limit was lowered to 4Mi, so the container is killed as soon as it starts: `describe pod` shows `OOMKilled` (or a start error) and the restart count climbs. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q1_NS}" set resources "deployment/${Q1_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### Image tag does not exist (ImagePullBackOff) (`image-pull`)

The image was changed to `nginx:1.27-alpne`, which does not exist: the Pods sit in `ErrImagePull` / `ImagePullBackOff`. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q1_NS}" set image "deployment/${Q1_APP}" web=nginx:1.27-alpine
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### Broken command (CrashLoopBackOff) (`bad-command`)

A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### ConfigMap key missing (CreateContainerConfigError) (`configmap-key`)

ConfigMap `${Q1_APP}-config` has the key `mod` instead of `mode`, so the containers cannot be created: `CreateContainerConfigError`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.

```bash
kubectl -n "${Q1_NS}" patch configmap "${Q1_APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### Liveness probe on the wrong port (`liveness-port`)

The liveness probe checks port 8080, where nothing listens, so the kubelet keeps killing healthy containers: the restart count climbs and the Events show `Liveness probe failed`. Point the probe back at port 80.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"tcpSocket":{"port":80}}}]}}}}'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### Readiness probe on the wrong path (`readiness-path`)

The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### CPU request larger than any node (Pending) (`requests-too-large`)

The CPU request was raised to 64 cores, so no node can fit a Pod: they stay `Pending` with `Insufficient cpu` in the Events. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q1_NS}" set resources "deployment/${Q1_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### nodeSelector matching no node (Pending) (`node-selector`)

A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

### Question 2: Back up etcd

```bash
mkdir -p "$(dirname "${Q2_BACKUP}")"
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save "${Q2_BACKUP}"
```

### Question 3: PersistentVolumeClaim ${Q3_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${Q3_NAME}"
  namespace: "${Q3_NS}"
spec:
  storageClassName: manual
  accessModes:
    - "${Q3_ACCESS}"
  resources:
    requests:
      storage: "${Q3_SIZE}"
  selector:
    matchLabels:
      tier: "${Q3_SELECT_TIER}"
---
apiVersion: v1
kind: Pod
metadata:
  name: "${Q3_NAME}-app"
  namespace: "${Q3_NS}"
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sleep
        - 1d
      volumeMounts:
        - name: data
          mountPath: "${Q3_POD_MOUNT}"
          readOnly: true
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: "${Q3_NAME}"
EOF
kubectl -n "${Q3_NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${Q3_NAME}" --timeout=60s
kubectl -n "${Q3_NS}" wait --for=condition=Ready "pod/${Q3_NAME}-app" --timeout=180s
kubectl -n "${Q3_NS}" delete pod "${Q3_NAME}-app" --ignore-not-found --wait=true
kubectl -n "${Q3_NS}" delete pvc "${Q3_NAME}" --wait=true
kubectl wait --for=jsonpath='{.status.phase}'=Released "pv/${Q3_NAME}-pv" --timeout=60s
```

### Question 4: Frontend cannot reach ${Q4_APP}

This run's fault: **`${Q4_FAULT}`**.

Every fault this question can roll:

#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```

#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```

#### Ingress allowed on the wrong port (`ingress-port`)

`${Q4_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "${Q4_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```

#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q4_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "${Q4_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```

#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=${Q4_APP}-v2`, which do not exist, so the client's own egress is dropped even though `${Q4_APP}-ingress` would accept it. Select `app=${Q4_APP}`.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"'"${Q4_APP}"'"}}]'
```

### Question 5: CronJob ${Q5_APP} never succeeds

This run's fault: **`${Q5_FAULT}`**.

Every fault this question can roll:

#### CronJob suspended (`suspended`)

The CronJob has `suspend: true`, so it never creates a Job: `kubectl get cronjob` shows `SUSPEND True` and no `LAST SCHEDULE`. Set `suspend: false`.

```bash
kubectl -n "${Q5_NS}" patch cronjob "${Q5_APP}" --type=merge -p '{"spec":{"suspend":false}}'
```

#### Schedule that never fires (`never-schedule`)

The schedule is `0 0 31 2 *`: midnight on February 31st, a date that never comes. It is valid cron syntax, so the API accepts it, but no Job is ever created. Set it back to `* * * * *`.

```bash
kubectl -n "${Q5_NS}" patch cronjob "${Q5_APP}" --type=merge -p '{"spec":{"schedule":"* * * * *"}}'
```

#### Job time limit shorter than the work (`deadline`)

Each Job has `activeDeadlineSeconds: 3`, but the command sleeps 8 seconds, so every Job is killed and marked failed with reason `DeadlineExceeded` (`kubectl describe job`). Remove the deadline.

```bash
kubectl -n "${Q5_NS}" patch cronjob "${Q5_APP}" --type=json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/activeDeadlineSeconds"}]'
```

#### Job command fails and is never retried (`backoff-zero-command`)

The command runs `ech` instead of `echo`, so the container exits with code 127 (`kubectl logs` shows `sh: ech: not found`), and `backoffLimit: 0` fails the Job on the first error. Fix the command and set `backoffLimit` back to `2`.

```bash
kubectl -n "${Q5_NS}" patch cronjob "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/backoffLimit","value":2},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/command/2","value":"date; sleep 8; echo report done"}]'
```

#### Image from a registry that does not exist (`image-registry`)

The image is `registry.invalid/busybox:1.36`, a registry host that does not resolve. The Jobs are created, but their Pods sit in `ErrImagePull` / `ImagePullBackOff` and never finish. Set the image back to `busybox:1.36`; the stuck Jobs can be deleted.

```bash
kubectl -n "${Q5_NS}" patch cronjob "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/image","value":"busybox:1.36"}]'
```

### Question 6: Cluster certificates

```bash
mkdir -p "$(dirname "${Q6_EXPIRY}")"
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate | cut -d= -f2 > "${Q6_EXPIRY}"
kubeadm certs renew apiserver
mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/kube-apiserver.yaml
for _ in $(seq 1 60); do
  [[ -z "$(crictl ps -q --name kube-apiserver 2>/dev/null)" ]] && break
  sleep 2
done
mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
for _ in $(seq 1 240); do
  [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
  sleep 3
done
```
