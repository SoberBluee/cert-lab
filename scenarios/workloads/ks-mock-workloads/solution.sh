#!/usr/bin/env bash
# Applied by "cka verify" on controlplane, after solution-q4-node.sh ran on $Q4_NODE.
# Each question branches on its rolled variant.
set -euo pipefail

# Question 1
case "$Q1_KIND" in
  init-sidecar)
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
    ;;
  native-sidecar-spread)
    kubectl apply -f - <<EOF
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
          restartPolicy: Always
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
EOF
    ;;
esac

# Question 2
case "$Q2_KIND" in
  approved-rollback)
    kubectl -n "$Q2_NS" patch deployment "$Q2_DEPLOY" -p '{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":0,"maxUnavailable":1}}}}'
    rev="$(kubectl -n "$Q2_NS" get rs -o json | jq -r '.items[] | select(.metadata.annotations["kubernetes.io/change-cause"] // "" | test("security-approved")) | .metadata.annotations["deployment.kubernetes.io/revision"]' | head -1)"
    kubectl -n "$Q2_NS" rollout undo "deployment/$Q2_DEPLOY" --to-revision="$rev"
    kubectl -n "$Q2_NS" get deployment "$Q2_DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' > /opt/course/q2/image.txt
    ;;
  failed-undo)
    kubectl -n "$Q2_NS" get deployment "$Q2_DEPLOY" -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}' > /opt/course/q2/reason.txt
    kubectl -n "$Q2_NS" rollout undo "deployment/$Q2_DEPLOY"
    kubectl -n "$Q2_NS" rollout status "deployment/$Q2_DEPLOY" --timeout=240s
    kubectl -n "$Q2_NS" set image "deployment/$Q2_DEPLOY" nginx=nginx:1.27-alpine
    kubectl -n "$Q2_NS" annotate deployment "$Q2_DEPLOY" kubernetes.io/change-cause="upgrade nginx to 1.27" --overwrite
    ;;
esac
kubectl -n "$Q2_NS" rollout status "deployment/$Q2_DEPLOY" --timeout=240s

# Question 3
case "$Q3_KIND" in
  cpu-hpa)
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
    ;;
  memory-hpa)
    kubectl -n "$Q3_NS" set resources "deployment/$Q3_DEPLOY" -c nginx --requests=memory=32Mi
    kubectl apply -f - <<EOF
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
EOF
    kubectl -n "$Q3_NS" create poddisruptionbudget "${Q3_DEPLOY}-pdb" --selector="app=${Q3_DEPLOY}" --max-unavailable=1
    ;;
esac

# Question 4
case "$Q4_KIND" in
  static-nodeport)
    kubectl -n default wait --for=condition=Ready "pod/${Q4_POD}-${Q4_NODE}" --timeout=180s
    kubectl -n default expose pod "${Q4_POD}-${Q4_NODE}" --name="${Q4_POD}-svc" --type=NodePort --port=80 --dry-run=client -o json \
      | jq --argjson np "$Q4_NODEPORT" '.spec.ports[0].nodePort = $np' | kubectl apply -f -
    ;;
  static-fix-move)
    dir="$(awk '/^staticPodPath:/ {print $2}' /var/lib/kubelet/config.yaml)"
    cat > "${dir:-/etc/kubernetes/manifests}/${Q4_POD}.yaml" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q4_POD}
  namespace: default
  labels: { run: ${Q4_POD} }
spec:
  containers:
    - name: ${Q4_POD}
      image: nginx:1.27-alpine
      ports: [{ containerPort: 80 }]
      resources:
        requests: { cpu: 10m, memory: 20Mi }
EOF
    timeout 180 bash -c "until kubectl -n default get pod '${Q4_POD}-controlplane' >/dev/null 2>&1; do sleep 2; done"
    kubectl -n default wait --for=condition=Ready "pod/${Q4_POD}-controlplane" --timeout=180s
    ;;
esac

# Question 5
kubectl create namespace "$Q5_NS"
case "$Q5_KIND" in
  priority-everywhere)
    kubectl create priorityclass "$Q5_PC" --value="$Q5_VALUE" --preemption-policy=Never
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
    ;;
  labelled-ondelete)
    kubectl label node "$Q5_NODE" "agent=${Q5_DS}" --overwrite
    ds() {
      kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: ${Q5_DS}, namespace: ${Q5_NS} }
spec:
  selector: { matchLabels: { app: ${Q5_DS} } }
  updateStrategy: { type: OnDelete }
  template:
    metadata: { labels: { app: ${Q5_DS} } }
    spec:
      nodeSelector: { agent: ${Q5_DS} }
      containers:
        - name: agent
          image: busybox:1.36
          command: ["sleep", "$1"]
EOF
    }
    ds infinity
    timeout 120 bash -c "until [ \"\$(kubectl -n '$Q5_NS' get daemonset '$Q5_DS' -o jsonpath='{.status.numberReady}')\" = 1 ]; do sleep 2; done"
    ds 3600
    kubectl -n "$Q5_NS" delete pod -l "app=${Q5_DS}" --wait=true
    timeout 120 bash -c "until [ \"\$(kubectl -n '$Q5_NS' get daemonset '$Q5_DS' -o jsonpath='{.status.numberReady}/{.status.updatedNumberScheduled}')\" = 1/1 ]; do sleep 2; done"
    ;;
esac

if [[ "$Q1_KIND" == init-sidecar ]]; then
  kubectl -n "$Q1_NS" wait --for=jsonpath='{.status.readyReplicas}'=2 "deployment/$Q1_DEPLOY" --timeout=180s
  msg=""
  for _ in $(seq 1 30); do
    msg="$(kubectl -n "$Q1_NS" get events --field-selector reason=FailedScheduling -o jsonpath='{.items[-1:].message}')"
    [[ -n "$msg" ]] && break
    sleep 2
  done
  echo "$msg" > /opt/course/q1/pending-reason.txt
else
  kubectl -n "$Q1_NS" rollout status "deployment/$Q1_DEPLOY" --timeout=180s
fi
