## Solution

### Question 1: Deployment ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
  labels:
    app: "${Q1_NAME}"
spec:
  replicas: 3
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
          image: nginx:1.26-alpine
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
EOF
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
kubectl -n "${Q1_NS}" patch "deployment/${Q1_NAME}" -p "{spec: {strategy: {type: RollingUpdate, rollingUpdate: {maxSurge: ${Q1_STRATEGY_SURGE}, maxUnavailable: 0}}}}"
```

### Question 2: Pod ${Q2_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: "${Q2_NAME}"
  namespace: "${Q2_NS}"
spec:
  containers:
    - name: main
      image: busybox:1.37
      command:
        - sh
        - -c
        - hostname | tee /data/out.log; sleep infinity
      securityContext:
        runAsUser: ${Q2_SEC_USER}
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      emptyDir: {}
EOF
kubectl -n "${Q2_NS}" wait --for=condition=Ready "pod/${Q2_NAME}" --timeout=180s
kubectl -n "${Q2_NS}" label pod "${Q2_NAME}" "${Q2_LABEL_KEY}=${Q2_LABEL_VALUE}" --overwrite
```

### Question 3: Unhealthy Deployment ${Q3_APP}

This run's fault: **`${Q3_FAULT}`**.

Every fault this question can roll:

#### Memory limit too low (OOMKilled) (`oom-killed`)

The memory limit was lowered to 4Mi, so the container is killed as soon as it starts: `describe pod` shows `OOMKilled` (or a start error) and the restart count climbs. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q3_NS}" set resources "deployment/${Q3_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

#### Image tag does not exist (ImagePullBackOff) (`image-pull`)

The image was changed to `nginx:1.27-alpne`, which does not exist: the Pods sit in `ErrImagePull` / `ImagePullBackOff`. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q3_NS}" set image "deployment/${Q3_APP}" web=nginx:1.27-alpine
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

#### Broken command (CrashLoopBackOff) (`bad-command`)

A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

#### ConfigMap key missing (CreateContainerConfigError) (`configmap-key`)

ConfigMap `${Q3_APP}-config` has the key `mod` instead of `mode`, so the containers cannot be created: `CreateContainerConfigError`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.

```bash
kubectl -n "${Q3_NS}" patch configmap "${Q3_APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${Q3_NS}" rollout restart "deployment/${Q3_APP}"
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

#### Liveness probe on the wrong port (`liveness-port`)

The liveness probe checks port 8080, where nothing listens, so the kubelet keeps killing healthy containers: the restart count climbs and the Events show `Liveness probe failed`. Point the probe back at port 80.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"tcpSocket":{"port":80}}}]}}}}'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

#### Readiness probe on the wrong path (`readiness-path`)

The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

#### CPU request larger than any node (Pending) (`requests-too-large`)

The CPU request was raised to 64 cores, so no node can fit a Pod: they stay `Pending` with `Insufficient cpu` in the Events. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q3_NS}" set resources "deployment/${Q3_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

#### nodeSelector matching no node (Pending) (`node-selector`)

A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```
