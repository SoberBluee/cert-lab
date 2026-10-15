## Solution

### Question 1: multi-container Deployment

<!-- fault Q1_KIND=init-sidecar -->
```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${Q1_DEPLOY}, namespace: ${Q1_NS} }
spec:
  replicas: 3
  selector: { matchLabels: { app: ${Q1_DEPLOY} } }
  template:
    metadata: { labels: { app: ${Q1_DEPLOY} } }
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector: { matchLabels: { app: ${Q1_DEPLOY} } }
              topologyKey: kubernetes.io/hostname
      initContainers:
        - name: seed
          image: busybox:1.36
          command: ["sh", "-c", "echo '<h1>${Q1_DEPLOY}</h1>' > /work/index.html"]
          volumeMounts: [{ name: content, mountPath: /work }]
      containers:
        - name: web
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits: { memory: 128Mi }
          volumeMounts:
            - { name: content, mountPath: /usr/share/nginx/html }
            - { name: logs, mountPath: /var/log/nginx }
        - name: log-tail
          image: busybox:1.36
          command: ["sh", "-c", "tail -F /var/log/nginx/access.log"]
          volumeMounts: [{ name: logs, mountPath: /var/log/nginx }]
      volumes:
        - { name: content, emptyDir: {} }
        - { name: logs, emptyDir: {} }
```

The trap is that the nginx image links `/var/log/nginx/access.log` to stdout. Mounting an emptyDir over `/var/log/nginx` hides those links, so nginx writes a real file the sidecar can follow. A native sidecar (an initContainer with `restartPolicy: Always`) works too.

There are only two schedulable nodes (the control plane is tainted), so the third replica stays Pending:

```bash
kubectl -n ${Q1_NS} get events --field-selector reason=FailedScheduling -o jsonpath='{.items[-1:].message}' > /opt/course/q1/pending-reason.txt
```
<!-- /fault -->
<!-- fault Q1_KIND=native-sidecar-spread -->
```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${Q1_DEPLOY}, namespace: ${Q1_NS} }
spec:
  replicas: 4
  selector: { matchLabels: { app: ${Q1_DEPLOY} } }
  template:
    metadata: { labels: { app: ${Q1_DEPLOY} } }
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          nodeTaintsPolicy: Honor
          labelSelector: { matchLabels: { app: ${Q1_DEPLOY} } }
      initContainers:
        - name: seed
          image: busybox:1.36
          command: ["sh", "-c", "echo '<h1>${Q1_DEPLOY}</h1>' > /work/index.html"]
          volumeMounts: [{ name: content, mountPath: /work }]
        - name: log-tail
          image: busybox:1.36
          restartPolicy: Always          # native sidecar
          command: ["sh", "-c", "touch /var/log/nginx/access.log; tail -F /var/log/nginx/access.log"]
          volumeMounts: [{ name: logs, mountPath: /var/log/nginx }]
      containers:
        - name: web
          image: nginx:1.27-alpine
          volumeMounts:
            - { name: content, mountPath: /usr/share/nginx/html }
            - { name: logs, mountPath: /var/log/nginx }
      volumes:
        - { name: content, emptyDir: {} }
        - { name: logs, emptyDir: {} }
```

The trap is the control plane. By default (`nodeTaintsPolicy: Ignore`), a topology spread constraint counts **every** node as a domain, including the tainted control plane, where no Pod can ever land. With 0 Pods there, `maxSkew: 1` allows only 1 Pod per worker, so 2 replicas stay Pending (`kubectl describe pod`: "didn't match pod topology spread constraints"). `nodeTaintsPolicy: Honor` leaves tainted nodes the Pod does not tolerate out of the count. A node affinity that excludes the control plane works as well, because node affinity is honored by default.

Init containers run in order, so `seed` finishes before the sidecar `log-tail` starts, and `web` starts once the sidecar is running. Like the classic sidecar, nginx needs the emptyDir over `/var/log/nginx` to write a real file instead of its stdout symlinks.
<!-- /fault -->

### Question 2: recover a stuck rollout

<!-- fault Q2_KIND=approved-rollback -->
```bash
kubectl -n ${Q2_NS} rollout history deploy/${Q2_DEPLOY}
# revision ${Q2_TARGET} is "... - security-approved"; revision 3 says "security review pending"
kubectl -n ${Q2_NS} patch deploy ${Q2_DEPLOY} -p '{"spec":{"strategy":{"rollingUpdate":{"maxSurge":0,"maxUnavailable":1}}}}'
kubectl -n ${Q2_NS} rollout undo deploy/${Q2_DEPLOY} --to-revision=${Q2_TARGET}
kubectl -n ${Q2_NS} rollout status deploy/${Q2_DEPLOY}
kubectl -n ${Q2_NS} get deploy ${Q2_DEPLOY} -o jsonpath='{.spec.template.spec.containers[0].image}' > /opt/course/q2/image.txt
```

After the rollback, the old revision number disappears from the history and reappears as the newest one. That is expected.
<!-- /fault -->
<!-- fault Q2_KIND=failed-undo -->
```bash
kubectl -n ${Q2_NS} rollout status deploy/${Q2_DEPLOY}
# error: deployment "${Q2_DEPLOY}" exceeded its progress deadline
kubectl -n ${Q2_NS} get deploy ${Q2_DEPLOY} -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}' > /opt/course/q2/reason.txt
# ProgressDeadlineExceeded
kubectl -n ${Q2_NS} rollout history deploy/${Q2_DEPLOY}
# 3  switch to the slim image   <- nginx:1.26-alpine-slim2 does not exist
kubectl -n ${Q2_NS} rollout undo deploy/${Q2_DEPLOY}            # back to revision 2 (nginx:1.26-alpine), now revision 4
kubectl -n ${Q2_NS} rollout status deploy/${Q2_DEPLOY}
kubectl -n ${Q2_NS} set image deploy/${Q2_DEPLOY} nginx=nginx:1.27-alpine
kubectl -n ${Q2_NS} annotate deploy/${Q2_DEPLOY} kubernetes.io/change-cause="upgrade nginx to 1.27" --overwrite
kubectl -n ${Q2_NS} rollout status deploy/${Q2_DEPLOY}
kubectl -n ${Q2_NS} rollout history deploy/${Q2_DEPLOY}        # 5  upgrade nginx to 1.27
```

`progressDeadlineSeconds` (30 here) is how long a rollout may go without progress before the Deployment reports `Progressing=False` with reason `ProgressDeadlineExceeded`. Kubernetes does not roll back by itself: the old Pods keep serving, and the stuck new Pod stays until you act. Annotate right after `set image`, while the new revision is the current one; `--record` no longer exists.
<!-- /fault -->

### Question 3: HPA and PDB

<!-- fault Q3_KIND=cpu-hpa -->
```bash
kubectl config use-context ${CTX_OPS}
kubectl -n ${Q3_NS} describe hpa ${Q3_DEPLOY}   # if created first: "missing request for cpu"
kubectl -n ${Q3_NS} set resources deploy/${Q3_DEPLOY} --requests=cpu=50m
kubectl -n ${Q3_NS} autoscale deploy ${Q3_DEPLOY} --min=2 --max=5 --cpu-percent=60
kubectl -n ${Q3_NS} edit hpa ${Q3_DEPLOY}
#   spec.behavior.scaleDown.stabilizationWindowSeconds: 30
kubectl -n ${Q3_NS} create pdb ${Q3_DEPLOY}-pdb --selector=app=${Q3_DEPLOY} --min-available=1
```
<!-- /fault -->
<!-- fault Q3_KIND=memory-hpa -->
```bash
kubectl config use-context ${CTX_OPS}
kubectl -n ${Q3_NS} set resources deploy/${Q3_DEPLOY} -c nginx --requests=memory=32Mi
kubectl -n ${Q3_NS} create pdb ${Q3_DEPLOY}-pdb --selector=app=${Q3_DEPLOY} --max-unavailable=1
```

`kubectl autoscale` only supports CPU, so write the HPA:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: ${Q3_DEPLOY}, namespace: ${Q3_NS} }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: ${Q3_DEPLOY} }
  minReplicas: 1
  maxReplicas: 6
  metrics:
    - type: Resource
      resource: { name: memory, target: { type: Utilization, averageUtilization: 70 } }
  behavior:
    scaleUp:
      policies: [{ type: Pods, value: 2, periodSeconds: 60 }]
```

Utilization is a percentage of the **request**, so without a memory request the HPA reports `FailedGetResourceMetric` and `ScalingActive=False`. A PDB takes either `minAvailable` or `maxUnavailable`, never both.
<!-- /fault -->

### Question 4: static Pods

<!-- fault Q4_KIND=static-nodeport -->
```bash
kubectl run ${Q4_POD} --image=nginx:1.27-alpine $do > ${Q4_POD}.yaml   # add resources.requests cpu 10m, memory 20Mi
scp ${Q4_POD}.yaml ${Q4_NODE}:
ssh ${Q4_NODE} sudo mv ${Q4_POD}.yaml /etc/kubernetes/manifests/
kubectl get pod ${Q4_POD}-${Q4_NODE} -o wide
kubectl expose pod ${Q4_POD}-${Q4_NODE} --name=${Q4_POD}-svc --type=NodePort --port=80 $do > svc.yaml
# set spec.ports[0].nodePort: ${Q4_NODEPORT}
kubectl apply -f svc.yaml
```

The mirror Pod is named `<pod>-<node>`. `kubectl expose` copies its labels (`run=${Q4_POD}`) into the selector.
<!-- /fault -->
<!-- fault Q4_KIND=static-fix-move -->
```bash
kubectl get pods -A -o wide | grep ${Q4_POD}
kubectl describe pod ${Q4_POD}-${Q4_NODE}
#   OutOfmemory: Node didn't have enough resource: memory, requested: 21474836480 ...
```

The kubelet rejects the Pod at admission, because it requests `20Gi` of memory. Once that is fixed, the image `nginx:1.27-alpnie` fails with `ErrImagePull`. Fix both, then move the file:

```bash
ssh ${Q4_NODE}
sudo grep staticPodPath /var/lib/kubelet/config.yaml       # /etc/kubernetes/manifests
sudo mv /etc/kubernetes/manifests/${Q4_POD}.yaml /tmp/      # the kubelet removes the Pod
# edit /tmp/${Q4_POD}.yaml: image nginx:1.27-alpine, requests memory 20Mi
exit
scp ${Q4_NODE}:/tmp/${Q4_POD}.yaml .
sudo cp ${Q4_POD}.yaml /etc/kubernetes/manifests/          # on controlplane
kubectl get pod ${Q4_POD}-controlplane -o wide
```

Do not leave a copy such as `${Q4_POD}.yaml.bak` in the manifest directory: the kubelet loads every file there except hidden ones. Static Pods ignore taints, because the kubelet runs them without the scheduler, so no toleration is needed on the control plane.
<!-- /fault -->

### Question 5: node agent DaemonSet

```bash
kubectl config use-context ${CTX_OPS}
kubectl create namespace ${Q5_NS}
kubectl -n ${Q5_NS} create deployment ${Q5_DS} --image=busybox:1.36 $do -- sleep infinity > ds.yaml
```

There is no `kubectl create daemonset`: change `kind` to `DaemonSet`, and remove `replicas`, `strategy` and `status`.

<!-- fault Q5_KIND=priority-everywhere -->
```bash
kubectl create priorityclass ${Q5_PC} --value=${Q5_VALUE} --preemption-policy=Never
```

Then add to the Pod template:

```yaml
    spec:
      priorityClassName: ${Q5_PC}
      tolerations:
        - { key: node-role.kubernetes.io/control-plane, operator: Exists, effect: NoSchedule }
      containers:
        - name: busybox
          resources: { requests: { cpu: 10m, memory: 16Mi } }
```
<!-- /fault -->
<!-- fault Q5_KIND=labelled-ondelete -->
```bash
kubectl label node ${Q5_NODE} agent=${Q5_DS}
```

Then add:

```yaml
spec:
  updateStrategy: { type: OnDelete }
  template:
    spec:
      nodeSelector: { agent: ${Q5_DS} }
```

```bash
kubectl apply -f ds.yaml
kubectl -n ${Q5_NS} get pods -o wide                      # one Pod, on ${Q5_NODE}
kubectl -n ${Q5_NS} edit ds ${Q5_DS}                      # command: [sleep, "3600"]
kubectl -n ${Q5_NS} get ds ${Q5_DS}                       # UP-TO-DATE 0: OnDelete does not replace it
kubectl -n ${Q5_NS} delete pod -l app=${Q5_DS}
kubectl -n ${Q5_NS} get pod -l app=${Q5_DS} -o jsonpath='{.items[0].spec.containers[0].command}'
```
<!-- /fault -->
