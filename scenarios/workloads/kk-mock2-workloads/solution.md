# Mock 2 practice: workloads and storage

## q1 — shared emptyDir + native sidecar

```yaml
spec:
  initContainers:
    - name: busybox-sidecar
      image: busybox:1.36
      restartPolicy: Always
      command: ["sleep", "7200"]
      volumeMounts: [{ name: ${Q1_VOL}, mountPath: /usr/src }]
  containers:
    - name: nginx
      image: nginx:1.27-alpine
      volumeMounts: [{ name: ${Q1_VOL}, mountPath: /var/log/nginx }]
  volumes:
    - name: ${Q1_VOL}
      emptyDir: {}
```

## q2 — node capacity

```bash
kubectl get node worker-1 -o jsonpath='{.status.capacity.cpu}'
kubectl get node worker-1 -o jsonpath='{.status.capacity.memory}'
echo "cpu: <value>" > /opt/course/worker-1-cpu.txt
echo "memory: <value>" > /opt/course/worker-1-memory.txt
```

## q3 — HPA with scale-down window

Create `autoscaling/v2` HPA `${Q3_APP}-hpa`: target Deployment `${Q3_APP}`, min 1, max 3, CPU 50%, `behavior.scaleDown.stabilizationWindowSeconds: 300`.

## q4 — request ≤ limit

Edit `/opt/course/app-wl/${Q4_POD}.yaml`: set `requests.memory` to `100Mi` (or less). Keep `limits.memory: 100Mi`. Apply.

## q5 — logging sidecar

Update `/opt/course/${Q5_POD}.yaml`: add container `busybox` with `tail -f /var/log/elastic-app.log`, share an `emptyDir` at `/var/log` with `elastic-app`. `kubectl replace -f ... --force`.
