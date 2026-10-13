## Solution

### Question 1: Deployment ${Q1_APP} not running

This run's fault: **`${Q1_FAULT}`**.

Every fault this question can roll:

#### ResourceQuota allows a single Pod (`quota-pods`)

ResourceQuota `pod-quota` caps the namespace at `1` Pod, so the ReplicaSet's second create is rejected with "exceeded quota" (`kubectl -n ${Q1_NS} describe rs`). Delete the quota or raise `pods` to at least `2`.

```bash
kubectl -n "${Q1_NS}" delete resourcequota pod-quota
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```

#### ResourceQuota requires CPU limits (`quota-limits`)

ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must set a CPU limit. The Pods have none and are rejected with "must specify limits.cpu". The spec rules out adding limits to the Deployment: delete the quota, or add a LimitRange that gives containers a default CPU limit.

```bash
kubectl -n "${Q1_NS}" delete resourcequota compute-quota
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```

#### LimitRange maximum below the request (`limitrange-max`)

LimitRange `container-limits` caps containers at `50m` CPU. Its max also becomes the default limit, which is below the `100m` request, so every Pod is rejected at admission. Delete the LimitRange or raise its max to at least `100m`.

```bash
kubectl -n "${Q1_NS}" delete limitrange container-limits
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```

#### Required node affinity matches no node (`node-affinity`)

The Pod template requires nodes labelled `disktype=ssd`, and no node has that label, so the Pods stay Pending with "didn't match Pod's node affinity/selector". The spec allows any node: remove the affinity.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```

#### Unknown PriorityClass (`priority-class`)

The Pod template asks for PriorityClass `critical-batch`, which does not exist, so the ReplicaSet's creates fail with "no PriorityClass with name critical-batch was found". The spec wants the default priority: remove `priorityClassName`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/priorityClassName"}]'
```

### Question 2: Control plane after maintenance

This run's fault: **`${Q2_FAULT}`**.

Every fault this question can roll:

#### API server talks to the etcd peer port (`apiserver-etcd-port`)

`--etcd-servers` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at port `2380`, etcd's peer port, instead of the client port `2379`. The API server cannot reach its storage and keeps exiting, so kubectl fails. `crictl logs` of the kube-apiserver container shows the etcd connection errors; `--listen-client-urls` in `etcd.yaml` shows the right port.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```

#### API server etcd client certificate path is wrong (`apiserver-etcd-certfile`)

`--etcd-certfile` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt`, which does not exist. The certificate lives one directory up, in `/etc/kubernetes/pki/`. The API server exits at startup with "no such file or directory", which `crictl logs` shows.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```

#### etcd server certificate path is wrong (`etcd-cert-path`)

`--cert-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `server.cert` instead of `server.crt`. etcd exits at startup, and the API server loses its storage with it. kubectl fails, the kube-apiserver logs show etcd connection errors, and `crictl logs` of the etcd container shows the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\.cert$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```

#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```

#### Controller manager kubeconfig path is wrong (`controller-manager-kubeconfig`)

`--kubeconfig` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` points at `controller-manager.config` instead of `controller-manager.conf`. The controller manager exits at startup, so the Deployment is scaled but no ReplicaSet creates Pods (`kubectl get deploy` shows 0 of 2, with no Pods at all). Its logs show the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/controller-manager)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```

#### controlplane kubelet client certificate path is wrong (`kubelet-client-cert`)

`client-certificate` in `/etc/kubernetes/kubelet.conf` points at `/var/lib/kubelet/pki/kubelet-client.pem`, which does not exist, so the kubelet on controlplane cannot authenticate and exits. The node turns `NotReady` while the static pods keep running. `journalctl -u kubelet` shows the missing file; `ls /var/lib/kubelet/pki` shows `kubelet-client-current.pem`. Fix the path and restart the kubelet.

```bash
sed -i -E 's#^([[:space:]]*client-certificate: /var/lib/kubelet/pki/)kubelet-client.pem$#\1kubelet-client-current.pem#' /etc/kubernetes/kubelet.conf
grep -qE -- 'client-certificate: /var/lib/kubelet/pki/kubelet-client-current.pem$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet
```

### Question 3: StorageClass ${Q3_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: "${Q3_NAME}"
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: "${Q3_RECLAIM}"
volumeBindingMode: "${Q3_BINDING}"
allowVolumeExpansion: true
EOF
kubectl annotate storageclass "${Q3_NAME}" storageclass.kubernetes.io/is-default-class=true --overwrite
```

### Question 4: Deployment ${Q4_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: "${Q4_NAME}"
  namespace: "${Q4_NS}"
  labels:
    app: "${Q4_NAME}"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: "${Q4_NAME}"
  template:
    metadata:
      labels:
        app: "${Q4_NAME}"
    spec:
      containers:
        - name: app
          image: nginx:1.26-alpine
          ports:
            - containerPort: 80
      tolerations:
        - key: dedicated
          operator: Equal
          value: "${Q4_TAINT_TEAM}"
          effect: NoSchedule
      nodeSelector:
        kubernetes.io/hostname: "${Q4_TAINT_NODE}"
---
apiVersion: v1
kind: Service
metadata:
  name: "${Q4_NAME}"
  namespace: "${Q4_NS}"
spec:
  type: ClusterIP
  selector:
    app: "${Q4_NAME}"
  ports:
    - port: 80
      targetPort: 80
EOF
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_NAME}" --timeout=240s
kubectl apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: "${Q4_NAME}"
  namespace: "${Q4_NS}"
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: "${Q4_NAME}" }
  minReplicas: 1
  maxReplicas: 8
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: ${Q4_HPA_CPU} } }
EOF
```
