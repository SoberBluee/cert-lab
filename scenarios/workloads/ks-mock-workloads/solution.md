## Solution

### Question 1: init container, sidecar, anti-affinity

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

### Question 2: roll back to the approved revision

```bash
kubectl -n ${Q2_NS} rollout history deploy/${Q2_DEPLOY}
# revision ${Q2_TARGET} is "... - security-approved"; revision 3 says "security review pending"
kubectl -n ${Q2_NS} patch deploy ${Q2_DEPLOY} -p '{"spec":{"strategy":{"rollingUpdate":{"maxSurge":0,"maxUnavailable":1}}}}'
kubectl -n ${Q2_NS} rollout undo deploy/${Q2_DEPLOY} --to-revision=${Q2_TARGET}
kubectl -n ${Q2_NS} rollout status deploy/${Q2_DEPLOY}
kubectl -n ${Q2_NS} get deploy ${Q2_DEPLOY} -o jsonpath='{.spec.template.spec.containers[0].image}' > /opt/course/q2/image.txt
```

After the rollback, the old revision number disappears from the history and reappears as the newest one. That is expected.

### Question 3: HPA and PDB

```bash
kubectl config use-context ${CTX_OPS}
kubectl -n ${Q3_NS} describe hpa ${Q3_DEPLOY}   # if created first: "missing request for cpu"
kubectl -n ${Q3_NS} set resources deploy/${Q3_DEPLOY} --requests=cpu=50m
kubectl -n ${Q3_NS} autoscale deploy ${Q3_DEPLOY} --min=2 --max=5 --cpu-percent=60
kubectl -n ${Q3_NS} edit hpa ${Q3_DEPLOY}
#   spec.behavior.scaleDown.stabilizationWindowSeconds: 30
kubectl -n ${Q3_NS} create pdb ${Q3_DEPLOY}-pdb --selector=app=${Q3_DEPLOY} --min-available=1
```

### Question 4: static Pod and NodePort

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

### Question 5: PriorityClass and DaemonSet

```bash
kubectl config use-context ${CTX_OPS}
kubectl create priorityclass ${Q5_PC} --value=${Q5_VALUE} --preemption-policy=Never
kubectl create namespace ${Q5_NS}
kubectl -n ${Q5_NS} create deployment ${Q5_DS} --image=busybox:1.36 $do -- sleep infinity > ds.yaml
```

Change `kind` to `DaemonSet`, and remove `replicas`, `strategy` and `status`. Then add:

```yaml
    spec:
      priorityClassName: ${Q5_PC}
      tolerations:
        - { key: node-role.kubernetes.io/control-plane, operator: Exists, effect: NoSchedule }
      containers:
        - name: busybox
          resources: { requests: { cpu: 10m, memory: 16Mi } }
```
