#!/usr/bin/env bash
set -euo pipefail

# q1
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q1_POD}
spec:
  initContainers:
    - name: busybox-sidecar
      image: busybox:1.36
      restartPolicy: Always
      command: ["sleep", "7200"]
      volumeMounts:
        - name: ${Q1_VOL}
          mountPath: /usr/src
  containers:
    - name: nginx
      image: nginx:1.27-alpine
      volumeMounts:
        - name: ${Q1_VOL}
          mountPath: /var/log/nginx
  volumes:
    - name: ${Q1_VOL}
      emptyDir: {}
EOF
kubectl wait --for=condition=Ready "pod/${Q1_POD}" --timeout=180s

# q2
cpu=$(kubectl get node worker-1 -o jsonpath='{.status.capacity.cpu}')
mem=$(kubectl get node worker-1 -o jsonpath='{.status.capacity.memory}')
mkdir -p /opt/course
echo "cpu: ${cpu}" >/opt/course/worker-1-cpu.txt
echo "memory: ${mem}" >/opt/course/worker-1-memory.txt
chown -R ubuntu:ubuntu /opt/course

# q3
kubectl -n "${Q3_NS}" apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${Q3_APP}-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${Q3_APP}
  minReplicas: 1
  maxReplicas: 3
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 50 }
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
EOF

# q4
sed -i 's/memory: 1Gi/memory: 100Mi/' "/opt/course/app-wl/${Q4_POD}.yaml"
kubectl apply -f "/opt/course/app-wl/${Q4_POD}.yaml"
kubectl wait --for=condition=Ready "pod/${Q4_POD}" --timeout=120s

# q5 — write YAML with python so shell does not expand $(date)/$i
kubectl delete pod "${Q5_POD}" --ignore-not-found --wait=true
python3 - <<'PY'
import os
pod = os.environ["Q5_POD"]
cmd = 'mkdir -p /var/log; i=0; while true; do echo "$(date) INFO $i" >> /var/log/elastic-app.log; i=$((i+1)); sleep 1; done'
open("/tmp/q5.yaml", "w").write(
    f"""apiVersion: v1
kind: Pod
metadata:
  name: {pod}
spec:
  containers:
    - name: elastic-app
      image: busybox:1.36
      args:
        - /bin/sh
        - -c
        - {cmd!r}
      volumeMounts:
        - name: varlog
          mountPath: /var/log
    - name: busybox
      image: busybox:1.36
      args: [/bin/sh, -c, 'tail -f /var/log/elastic-app.log']
      volumeMounts:
        - name: varlog
          mountPath: /var/log
  volumes:
    - name: varlog
      emptyDir: {{}}
"""
)
PY
# cmd!r produces a quoted Python string — bad for YAML. Write plain:
python3 - <<'PY'
import os, yaml
pod = os.environ["Q5_POD"]
doc = {
  "apiVersion": "v1",
  "kind": "Pod",
  "metadata": {"name": pod},
  "spec": {
    "containers": [
      {
        "name": "elastic-app",
        "image": "busybox:1.36",
        "args": ["/bin/sh", "-c", 'mkdir -p /var/log; i=0; while true; do echo "$(date) INFO $i" >> /var/log/elastic-app.log; i=$((i+1)); sleep 1; done'],
        "volumeMounts": [{"name": "varlog", "mountPath": "/var/log"}],
      },
      {
        "name": "busybox",
        "image": "busybox:1.36",
        "args": ["/bin/sh", "-c", "tail -f /var/log/elastic-app.log"],
        "volumeMounts": [{"name": "varlog", "mountPath": "/var/log"}],
      },
    ],
    "volumes": [{"name": "varlog", "emptyDir": {}}],
  },
}
# Prefer kubectl with a here-doc file without PyYAML dependency
open("/tmp/q5.yaml","w").write(
f"""apiVersion: v1
kind: Pod
metadata:
  name: {pod}
spec:
  containers:
    - name: elastic-app
      image: busybox:1.36
      args:
        - /bin/sh
        - -c
        - |
          mkdir -p /var/log
          i=0
          while true; do
            echo "$(date) INFO $i" >> /var/log/elastic-app.log
            i=$((i+1))
            sleep 1
          done
      volumeMounts:
        - name: varlog
          mountPath: /var/log
    - name: busybox
      image: busybox:1.36
      args: [/bin/sh, -c, 'tail -f /var/log/elastic-app.log']
      volumeMounts:
        - name: varlog
          mountPath: /var/log
  volumes:
    - name: varlog
      emptyDir: {{}}
""")
PY
kubectl apply -f /tmp/q5.yaml
kubectl wait --for=condition=Ready "pod/${Q5_POD}" --timeout=180s
sleep 3
