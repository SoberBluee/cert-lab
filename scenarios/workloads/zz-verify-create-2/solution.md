## Solution

### Question 1: Deployment ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: "${Q1_PRIO_CLASS}"
value: ${Q1_PRIO_VALUE}
globalDefault: false
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: "${Q1_SA_SA}"
  namespace: "${Q1_NS}"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: "${Q1_ENV_OBJ}"
  namespace: "${Q1_NS}"
data:
  "${Q1_ENV_KEY}": "${Q1_ENV_VALUE}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
  labels:
    app: "${Q1_NAME}"
spec:
  replicas: ${Q1_REPLICAS}
  selector:
    matchLabels:
      app: "${Q1_NAME}"
  template:
    metadata:
      labels:
        app: "${Q1_NAME}"
    spec:
      containers:
        - name: app
          image: "${Q1_IMAGE}"
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: ${Q1_PROBES_PERIOD}
          livenessProbe:
            tcpSocket:
              port: 80
            periodSeconds: ${Q1_PROBES_PERIOD}
          env:
            - name: "${Q1_ENV_KEY}"
              valueFrom:
                configMapKeyRef:
                  name: "${Q1_ENV_OBJ}"
                  key: "${Q1_ENV_KEY}"
          volumeMounts:
            - name: html
              mountPath: /usr/share/nginx/html
      volumes:
        - name: html
          emptyDir: {}
      initContainers:
        - name: content
          image: busybox:1.36
          command:
            - sh
            - -c
            - "echo ${Q1_INIT_TEXT} > /work/index.html"
          volumeMounts:
            - name: html
              mountPath: /work
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          nodeTaintsPolicy: Honor
          labelSelector:
            matchLabels:
              app: "${Q1_NAME}"
      serviceAccountName: "${Q1_SA_SA}"
      automountServiceAccountToken: false
      priorityClassName: "${Q1_PRIO_CLASS}"
  revisionHistoryLimit: ${Q1_REV_HISTORY}
  minReadySeconds: ${Q1_REV_MINREADY}
---
apiVersion: v1
kind: Service
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
spec:
  type: "${Q1_EXPOSE_TYPE}"
  selector:
    app: "${Q1_NAME}"
  ports:
    - port: ${Q1_EXPOSE_PORT}
      targetPort: 80
EOF
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
kubectl -n "${Q1_NS}" set image "deployment/${Q1_NAME}" "*=${Q1_UPDATE_IMAGE}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
kubectl -n "${Q1_NS}" scale "deployment/${Q1_NAME}" --replicas="${Q1_SCALE_REPLICAS}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
intstr() { [[ "$1" == *% ]] && printf '"%s"' "$1" || printf '%s' "$1"; }
kubectl -n "${Q1_NS}" patch "deployment/${Q1_NAME}" -p "{\"spec\": {\"strategy\": {\"type\": \"RollingUpdate\", \"rollingUpdate\": {\"maxSurge\": $(intstr "${Q1_STRATEGY_SURGE}"), \"maxUnavailable\": $(intstr "${Q1_STRATEGY_UNAVAILABLE}")}}}}"
kubectl -n "${Q1_NS}" rollout undo "deployment/${Q1_NAME}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
kubectl -n "${Q1_NS}" annotate "deployment/${Q1_NAME}" kubernetes.io/change-cause="${Q1_CAUSE_CAUSE}" --overwrite
kubectl -n "${Q1_NS}" set env "deployment/${Q1_NAME}" "${Q1_SETENV_KEY}=${Q1_SETENV_VALUE}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_NAME}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
kubectl -n "${Q1_NS}" set resources "deployment/${Q1_NAME}" --requests="cpu=${Q1_SETRES_CPU}" --limits="memory=${Q1_SETRES_MEMORY}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
kubectl apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: "${Q1_NAME}" }
  minReplicas: ${Q1_HPA_MIN}
  maxReplicas: ${Q1_HPA_MAX}
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: ${Q1_HPA_CPU} } }
EOF
```

### Question 2: Pod ${Q2_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: "${Q2_FILES_OBJ}"
  namespace: "${Q2_NS}"
data:
  "${Q2_FILES_FILE}": "${Q2_FILES_VALUE}"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${Q2_PVC_CLAIM}"
  namespace: "${Q2_NS}"
spec:
  storageClassName: manual
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: "${Q2_PVC_SIZE}"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: "${Q2_ENV_OBJ}"
  namespace: "${Q2_NS}"
data:
  "${Q2_ENV_KEY}": "${Q2_ENV_VALUE}"
---
apiVersion: v1
kind: Pod
metadata:
  name: "${Q2_NAME}"
  namespace: "${Q2_NS}"
spec:
  containers:
    - name: main
      image: "${Q2_IMAGE}"
      command:
        - sh
        - -c
        - while true; do date | tee -a /data/out.log; sleep 5; done
      volumeMounts:
        - name: data
          mountPath: /data
        - name: store
          mountPath: "${Q2_PVC_MOUNT}"
        - name: init
          mountPath: /init
        - name: files
          mountPath: /etc/app
          readOnly: true
      env:
        - name: "${Q2_ENV_KEY}"
          valueFrom:
            configMapKeyRef:
              name: "${Q2_ENV_OBJ}"
              key: "${Q2_ENV_KEY}"
      securityContext:
        runAsUser: ${Q2_SEC_USER}
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
          add:
            - "${Q2_CAPS_CAP}"
      resources:
        requests:
          cpu: "${Q2_RES_CPU}"
          memory: 64Mi
        limits:
          cpu: "1"
          memory: "${Q2_RES_MEMORY}"
      livenessProbe:
        exec:
          command:
            - ls
            - /
        periodSeconds: ${Q2_PROBE_PERIOD}
    - name: tailer
      image: busybox:1.36
      command:
        - sh
        - -c
        - tail -F /data/out.log
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      emptyDir: {}
    - name: store
      persistentVolumeClaim:
        claimName: "${Q2_PVC_CLAIM}"
    - name: init
      emptyDir: {}
    - name: files
      configMap:
        name: "${Q2_FILES_OBJ}"
  initContainers:
    - name: prepare
      image: busybox:1.36
      command:
        - sh
        - -c
        - "echo ${Q2_INIT_TEXT} > /init/ready"
      volumeMounts:
        - name: init
          mountPath: /init
  nodeName: "${Q2_PLACE_NODE}"
EOF
kubectl -n "${Q2_NS}" wait --for=condition=Ready "pod/${Q2_NAME}" --timeout=180s
kubectl -n "${Q2_NS}" label pod "${Q2_NAME}" "${Q2_LABEL_KEY}=${Q2_LABEL_VALUE}" --overwrite
kubectl -n "${Q2_NS}" annotate pod "${Q2_NAME}" "${Q2_NOTE_KEY}=${Q2_NOTE_VALUE}" --overwrite
kubectl -n "${Q2_NS}" set image "pod/${Q2_NAME}" "main=${Q2_UPDATE_IMAGE}"
timeout 180 bash -c 'until [[ "$(kubectl -n "$0" get pod "$1" -o jsonpath="{.status.containerStatuses[?(@.name==\"main\")].restartCount}")" -ge 1 ]] 2>/dev/null; do sleep 2; done' "${Q2_NS}" "${Q2_NAME}"
kubectl -n "${Q2_NS}" wait --for=condition=Ready "pod/${Q2_NAME}" --timeout=120s
kubectl -n "${Q2_NS}" patch pod "${Q2_NAME}" --subresource resize -p '{"spec": {"containers": [{"name": "main", "resources": {"requests": {"cpu": "'"${Q2_RESIZE_CPU}"'"}}}]}}'
kubectl -n "${Q2_NS}" logs "${Q2_NAME}" -c main > "/opt/${Q2_NAME}.log"
kubectl -n "${Q2_NS}" cp "${Q2_NAME}:/data/out.log" "/opt/${Q2_NAME}-out.log" -c main
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
  volumeName: "${Q3_NAME}-pv"
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
kubectl patch pv "${Q3_NAME}-pv" --type json -p '[{"op": "remove", "path": "/spec/claimRef"}]'
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${Q3_NAME}-v2"
  namespace: "${Q3_NS}"
spec:
  storageClassName: manual
  accessModes: ["${Q3_ACCESS}"]
  volumeName: "${Q3_NAME}-pv"
  resources:
    requests:
      storage: "${Q3_SIZE}"
EOF
kubectl -n "${Q3_NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${Q3_NAME}-v2" --timeout=60s
```

### Question 4: PersistentVolume ${Q4_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolume
metadata:
  name: "${Q4_NAME}"
  labels:
    tier: "${Q4_LABEL_TIER}"
spec:
  capacity:
    storage: "${Q4_CAPACITY}"
  accessModes:
    - "${Q4_ACCESS}"
  persistentVolumeReclaimPolicy: "${Q4_RECLAIM}"
  storageClassName: manual
  hostPath:
    path: "/srv/${Q4_NAME}"
    type: DirectoryOrCreate
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - "${Q4_AFFINITY_NODE}"
EOF
kubectl patch pv "${Q4_NAME}" -p '{"spec": {"capacity": {"storage": "'"${Q4_RESIZE_CAPACITY}"'"}}}'
kubectl patch pv "${Q4_NAME}" -p '{"spec": {"claimRef": {"namespace": "'"${Q4_RESERVE_NS}"'", "name": "'"${Q4_RESERVE_CLAIM}"'"}}}'
```

### Question 5: StorageClass ${Q5_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: "${Q5_NAME}"
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: "${Q5_RECLAIM}"
volumeBindingMode: "${Q5_BINDING}"
EOF
kubectl patch storageclass "${Q5_NAME}" -p '{"allowVolumeExpansion": true}'
kubectl annotate storageclass "${Q5_NAME}" storageclass.kubernetes.io/is-default-class=true --overwrite
new=Immediate; [[ "${Q5_BINDING}" == Immediate ]] && new=WaitForFirstConsumer
kubectl get storageclass "${Q5_NAME}" -o yaml | sed "s/^volumeBindingMode: .*/volumeBindingMode: $new/" | kubectl replace --force -f -
```
