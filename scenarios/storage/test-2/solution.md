## Solution

### Question 1: StorageClass ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: "${Q1_NAME}"
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: "${Q1_RECLAIM}"
volumeBindingMode: "${Q1_BINDING}"
allowVolumeExpansion: true
EOF
new=Immediate; [[ "${Q1_BINDING}" == Immediate ]] && new=WaitForFirstConsumer
kubectl get storageclass "${Q1_NAME}" -o yaml | sed "s/^volumeBindingMode: .*/volumeBindingMode: $new/" | kubectl replace --force -f -
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
      image: nginx:1.28-alpine
      command:
        - sleep
        - 1d
      securityContext:
        runAsUser: ${Q2_SEC_USER}
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
          add:
            - "${Q2_CAPS_CAP}"
EOF
kubectl -n "${Q2_NS}" wait --for=condition=Ready "pod/${Q2_NAME}" --timeout=180s
```

### Question 3: Service ${Q3_APP} unreachable

This run's fault: **`${Q3_FAULT}`**.

Every fault this question can roll:

#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=${Q3_APP}-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=${Q3_APP}`.

```bash
kubectl -n "${Q3_NS}" patch service "${Q3_APP}" -p '{"spec":{"selector":{"app":"'"${Q3_APP}"'"}}}'
```

#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q3_NS}" patch service "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```

#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

#### NetworkPolicy blocks the traffic (`network-policy`)

NetworkPolicy `${Q3_APP}-ingress` only lets in Pods labelled `role=monitoring`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.

```bash
kubectl -n "${Q3_NS}" delete networkpolicy "${Q3_APP}-ingress"
```

#### Readiness probe fails, so there are no ready endpoints (`not-ready`)

The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```

### Question 4: Unhealthy worker

This run's fault: **`${Q4_FAULT}`** on `${Q4_NODE}`.

Every fault this question can roll:

#### kubelet stopped and disabled (`kubelet-stopped`)

The kubelet was stopped and disabled, so the node stops sending heartbeats and turns `NotReady`. `systemctl status kubelet` shows it inactive. `systemctl enable --now kubelet` fixes it now and after a reboot.

On the broken worker:

```bash
systemctl enable --now kubelet
```

#### containerd stopped and disabled (`containerd-stopped`)

The container runtime was stopped and disabled. The kubelet keeps running but reports `container runtime is down` / `NotReady`, and its log is full of CRI connection errors. `systemctl enable --now containerd` fixes it.

On the broken worker:

```bash
systemctl enable --now containerd
systemctl restart kubelet
```

#### kubelet unit points at the wrong binary (`kubelet-binary-path`)

The kubeadm drop-in (`10-kubeadm.conf`) starts `/usr/local/bin/kubelet`, which does not exist, so the service fails with `status=203/EXEC`. `systemctl cat kubelet` shows the path; `which kubelet` shows the real one. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
systemctl daemon-reload
systemctl restart kubelet
```

#### Node cordoned (`cordoned`)

The node is `Ready` but cordoned (`SchedulingDisabled`), so no new Pods land on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q4_NODE}"
```

#### Stray NoSchedule taint (`stray-taint`)

A `maintenance=true:NoSchedule` taint keeps every Pod without a matching toleration off the node, including the probe Pod. `kubectl describe node` lists it under Taints; remove it with `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q4_NODE}" maintenance-
```

### Question 5: Unhealthy Deployment ${Q5_APP}

This run's fault: **`${Q5_FAULT}`**.

Every fault this question can roll:

#### Memory limit too low (OOMKilled) (`oom-killed`)

The memory limit was lowered to 4Mi, so the container is killed as soon as it starts: `describe pod` shows `OOMKilled` (or a start error) and the restart count climbs. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q5_NS}" set resources "deployment/${Q5_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
```

#### Image tag does not exist (ImagePullBackOff) (`image-pull`)

The image was changed to `nginx:1.27-alpne`, which does not exist: the Pods sit in `ErrImagePull` / `ImagePullBackOff`. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q5_NS}" set image "deployment/${Q5_APP}" web=nginx:1.27-alpine
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
```

#### Broken command (CrashLoopBackOff) (`bad-command`)

A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.

```bash
kubectl -n "${Q5_NS}" patch deployment "${Q5_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
```

#### ConfigMap key missing (CreateContainerConfigError) (`configmap-key`)

ConfigMap `${Q5_APP}-config` has the key `mod` instead of `mode`, so the containers cannot be created: `CreateContainerConfigError`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.

```bash
kubectl -n "${Q5_NS}" patch configmap "${Q5_APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${Q5_NS}" rollout restart "deployment/${Q5_APP}"
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
```

#### Liveness probe on the wrong port (`liveness-port`)

The liveness probe checks port 8080, where nothing listens, so the kubelet keeps killing healthy containers: the restart count climbs and the Events show `Liveness probe failed`. Point the probe back at port 80.

```bash
kubectl -n "${Q5_NS}" patch deployment "${Q5_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"tcpSocket":{"port":80}}}]}}}}'
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
```

#### Readiness probe on the wrong path (`readiness-path`)

The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.

```bash
kubectl -n "${Q5_NS}" patch deployment "${Q5_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
```

#### CPU request larger than any node (Pending) (`requests-too-large`)

The CPU request was raised to 64 cores, so no node can fit a Pod: they stay `Pending` with `Insufficient cpu` in the Events. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q5_NS}" set resources "deployment/${Q5_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
```

#### nodeSelector matching no node (Pending) (`node-selector`)

A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.

```bash
kubectl -n "${Q5_NS}" patch deployment "${Q5_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${Q5_NS}" rollout status "deployment/${Q5_APP}" --timeout=240s
```
