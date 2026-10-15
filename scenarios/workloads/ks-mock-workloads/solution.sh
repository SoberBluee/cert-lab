#!/usr/bin/env bash
# Applied by "cka verify" on controlplane, after solution-q4-node.sh wrote the static Pod on $Q4_NODE.
set -euo pipefail

# Question 1
kubectl apply -f - <<EOF
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
EOF

# Question 2
kubectl -n "$Q2_NS" patch deployment "$Q2_DEPLOY" -p '{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":0,"maxUnavailable":1}}}}'
rev="$(kubectl -n "$Q2_NS" get rs -o json | jq -r '.items[] | select(.metadata.annotations["kubernetes.io/change-cause"] // "" | test("security-approved")) | .metadata.annotations["deployment.kubernetes.io/revision"]' | head -1)"
kubectl -n "$Q2_NS" rollout undo "deployment/$Q2_DEPLOY" --to-revision="$rev"
kubectl -n "$Q2_NS" get deployment "$Q2_DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' > /opt/course/q2/image.txt
kubectl -n "$Q2_NS" rollout status "deployment/$Q2_DEPLOY" --timeout=240s

# Question 3
kubectl -n "$Q3_NS" set resources "deployment/$Q3_DEPLOY" --requests=cpu=50m
kubectl apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: ${Q3_DEPLOY}, namespace: ${Q3_NS} }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: ${Q3_DEPLOY} }
  minReplicas: 2
  maxReplicas: 5
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 60 } }
  behavior:
    scaleDown: { stabilizationWindowSeconds: 30 }
EOF
kubectl -n "$Q3_NS" create poddisruptionbudget "${Q3_DEPLOY}-pdb" --selector="app=${Q3_DEPLOY}" --min-available=1

# Question 4
kubectl -n default wait --for=condition=Ready "pod/${Q4_POD}-${Q4_NODE}" --timeout=180s
kubectl -n default expose pod "${Q4_POD}-${Q4_NODE}" --name="${Q4_POD}-svc" --type=NodePort --port=80 --dry-run=client -o json \
  | jq --argjson np "$Q4_NODEPORT" '.spec.ports[0].nodePort = $np' | kubectl apply -f -

# Question 5
kubectl create priorityclass "$Q5_PC" --value="$Q5_VALUE" --preemption-policy=Never
kubectl create namespace "$Q5_NS"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: ${Q5_DS}, namespace: ${Q5_NS} }
spec:
  selector: { matchLabels: { app: ${Q5_DS} } }
  template:
    metadata: { labels: { app: ${Q5_DS} } }
    spec:
      priorityClassName: ${Q5_PC}
      tolerations:
        - { key: node-role.kubernetes.io/control-plane, operator: Exists, effect: NoSchedule }
      containers:
        - name: agent
          image: busybox:1.36
          command: ["sleep", "infinity"]
          resources: { requests: { cpu: 10m, memory: 16Mi } }
EOF
kubectl -n "$Q5_NS" rollout status "daemonset/$Q5_DS" --timeout=180s
kubectl -n "$Q1_NS" wait --for=jsonpath='{.status.readyReplicas}'=2 "deployment/$Q1_DEPLOY" --timeout=180s
msg=""
for _ in $(seq 1 30); do
  msg="$(kubectl -n "$Q1_NS" get events --field-selector reason=FailedScheduling -o jsonpath='{.items[-1:].message}')"
  [[ -n "$msg" ]] && break
  sleep 2
done
echo "$msg" > /opt/course/q1/pending-reason.txt
