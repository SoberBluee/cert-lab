## Solution

### Question 1: Autoscaler ${Q1_APP} not working

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=no-cpu-request -->
#### Deployment has no CPU request (`no-cpu-request`)

Utilization is measured against the container's CPU request, and `web` has none, so the autoscaler reports "missing request for cpu" (FailedGetResourceMetric) and its target stays `<unknown>`. Set the request back to `50m`: `kubectl -n ${Q1_NS} set resources deployment ${Q1_APP} -c web --requests=cpu=50m,memory=32Mi`.

```bash
kubectl -n "${Q1_NS}" set resources "deployment/${Q1_APP}" -c web --requests=cpu=50m,memory=32Mi
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-name -->
#### Autoscaler targets a missing Deployment (`target-name`)

`scaleTargetRef.name` is `${Q1_APP}-v2`, which does not exist, so the autoscaler fails with FailedGetScale and never scales `${Q1_APP}`. Point it back at Deployment `${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch hpa "${Q1_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"name":"'"${Q1_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-kind -->
#### Autoscaler targets the wrong kind (`target-kind`)

`scaleTargetRef.kind` is `StatefulSet`, and there is no StatefulSet `${Q1_APP}`, so the autoscaler fails with FailedGetScale. Set the kind back to `Deployment`.

```bash
kubectl -n "${Q1_NS}" patch hpa "${Q1_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"kind":"Deployment"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=max-one -->
#### Replica range pinned to one (`max-one`)

The autoscaler's range is `1`-`1`, so it scaled `${Q1_APP}` down to a single replica and can never add more (ScalingLimited). Scaling the Deployment by hand does not help: the autoscaler overrides it. Restore `minReplicas: 2` and `maxReplicas: 6`.

```bash
kubectl -n "${Q1_NS}" patch hpa "${Q1_APP}" --type=merge -p '{"spec":{"minReplicas":2,"maxReplicas":6}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=metrics-server-down -->
#### metrics-server scaled to zero (`metrics-server-down`)

The `kube-system/metrics-server` Deployment has `0` replicas, so the `v1beta1.metrics.k8s.io` APIService is unavailable, `kubectl top` fails, and every autoscaler shows `<unknown>` targets. Scale it back to `1` replica.

```bash
kubectl -n kube-system scale deployment/metrics-server --replicas=1
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done
```
<!-- /fault -->

<!-- fault Q1_FAULT=metrics-apiservice -->
#### metrics-server Service points at the wrong port (`metrics-apiservice`)

metrics-server itself runs, but its Service sends traffic to port `8443`, where nothing listens. The `v1beta1.metrics.k8s.io` APIService behind that Service is unavailable (`kubectl get apiservice v1beta1.metrics.k8s.io` shows FailedDiscoveryCheck), so `kubectl top` and every autoscaler fail. Set the Service's `targetPort` back to the container's port (named `https`).

```bash
port="$(kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].ports[0].name}')"
kubectl -n kube-system patch service metrics-server --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/ports/0/targetPort\",\"value\":\"$port\"}]"
kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done
```
<!-- /fault -->

### Question 2: Deployment ${Q2_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: "${Q2_PRIO_CLASS}"
value: ${Q2_PRIO_VALUE}
globalDefault: false
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: "${Q2_SA_SA}"
  namespace: "${Q2_NS}"
---
apiVersion: v1
kind: Secret
metadata:
  name: "${Q2_ENV_OBJ}"
  namespace: "${Q2_NS}"
stringData:
  "${Q2_ENV_KEY}": "${Q2_ENV_VALUE}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: "${Q2_NAME}"
  namespace: "${Q2_NS}"
  labels:
    app: "${Q2_NAME}"
spec:
  replicas: ${Q2_REPLICAS}
  selector:
    matchLabels:
      app: "${Q2_NAME}"
  template:
    metadata:
      labels:
        app: "${Q2_NAME}"
    spec:
      containers:
        - name: app
          image: "${Q2_IMAGE}"
          ports:
            - containerPort: 80
          volumeMounts:
            - name: html
              mountPath: /usr/share/nginx/html
          env:
            - name: "${Q2_ENV_KEY}"
              valueFrom:
                secretKeyRef:
                  name: "${Q2_ENV_OBJ}"
                  key: "${Q2_ENV_KEY}"
          readinessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: ${Q2_PROBES_PERIOD}
          livenessProbe:
            tcpSocket:
              port: 80
            periodSeconds: ${Q2_PROBES_PERIOD}
          resources:
            requests:
              cpu: "${Q2_RES_CPU}"
              memory: 64Mi
            limits:
              cpu: "1"
              memory: "${Q2_RES_MEMORY}"
      volumes:
        - name: html
          emptyDir: {}
      initContainers:
        - name: content
          image: busybox:1.36
          command:
            - sh
            - -c
            - "echo ${Q2_INIT_TEXT} > /work/index.html"
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
              app: "${Q2_NAME}"
      serviceAccountName: "${Q2_SA_SA}"
      automountServiceAccountToken: false
      priorityClassName: "${Q2_PRIO_CLASS}"
  revisionHistoryLimit: ${Q2_REV_HISTORY}
  minReadySeconds: ${Q2_REV_MINREADY}
---
apiVersion: v1
kind: Service
metadata:
  name: "${Q2_NAME}"
  namespace: "${Q2_NS}"
spec:
  type: "${Q2_EXPOSE_TYPE}"
  selector:
    app: "${Q2_NAME}"
  ports:
    - port: ${Q2_EXPOSE_PORT}
      targetPort: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: "${Q2_NAME}"
  namespace: "${Q2_NS}"
spec:
  ingressClassName: traefik
  rules:
    - host: "${Q2_INGRESS_SUB}.${Q2_NS}.lab"
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: "${Q2_NAME}"
                port:
                  number: ${Q2_EXPOSE_PORT}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: "${Q2_NAME}"
  namespace: "${Q2_NS}"
spec:
  parentRefs:
    - name: traefik-gateway
      namespace: traefik
  hostnames:
    - "${Q2_ROUTE_SUB}.${Q2_NS}.lab"
  rules:
    - backendRefs:
        - name: "${Q2_NAME}"
          port: ${Q2_EXPOSE_PORT}
EOF
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_NAME}" --timeout=240s
for _ in $(seq 1 30); do [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'Host: ${Q2_INGRESS_SUB}.${Q2_NS}.lab' http://controlplane:30080/)" == 200 ]] && break; sleep 2; done
for _ in $(seq 1 30); do [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'Host: ${Q2_ROUTE_SUB}.${Q2_NS}.lab' http://controlplane:30080/)" == 200 ]] && break; sleep 2; done
kubectl -n "${Q2_NS}" set env "deployment/${Q2_NAME}" "${Q2_SETENV_KEY}=${Q2_SETENV_VALUE}"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_NAME}" --timeout=240s
kubectl -n "${Q2_NS}" scale "deployment/${Q2_NAME}" --replicas="${Q2_SCALE_REPLICAS}"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_NAME}" --timeout=240s
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_NAME}"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_NAME}" --timeout=240s
intstr() { [[ "$1" == *% ]] && printf '"%s"' "$1" || printf '%s' "$1"; }
kubectl -n "${Q2_NS}" patch "deployment/${Q2_NAME}" -p "{\"spec\": {\"strategy\": {\"type\": \"RollingUpdate\", \"rollingUpdate\": {\"maxSurge\": $(intstr "${Q2_STRATEGY_SURGE}"), \"maxUnavailable\": $(intstr "${Q2_STRATEGY_UNAVAILABLE}")}}}}"
kubectl -n "${Q2_NS}" set image "deployment/${Q2_NAME}" "*=${Q2_UPDATE_IMAGE}"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_NAME}" --timeout=240s
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
EOF
kubectl -n "${Q3_NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${Q3_NAME}" --timeout=60s
kubectl -n "${Q3_NS}" delete pod "${Q3_NAME}-app" --ignore-not-found --wait=true
kubectl -n "${Q3_NS}" delete pvc "${Q3_NAME}" --wait=true
kubectl wait --for=jsonpath='{.status.phase}'=Released "pv/${Q3_NAME}-pv" --timeout=60s
```

### Question 4: Restore etcd

```bash
etcdutl snapshot restore "${Q4_SNAPSHOT}" --data-dir "${Q4_DATADIR}"
sed -i -E "s#path: /var/lib/etcd\$#path: ${Q4_DATADIR}#" /etc/kubernetes/manifests/etcd.yaml
grep -q -- "path: ${Q4_DATADIR}" /etc/kubernetes/manifests/etcd.yaml
for _ in $(seq 1 240); do
  [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
  sleep 3
done
[[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]]
```
