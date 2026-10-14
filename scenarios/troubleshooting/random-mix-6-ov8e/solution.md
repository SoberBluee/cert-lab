## Solution

### Question 1: Control plane after maintenance

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=apiserver-etcd-port -->
#### API server talks to the etcd peer port (`apiserver-etcd-port`)

`--etcd-servers` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at port `2380`, etcd's peer port, instead of the client port `2379`. The API server cannot reach its storage and keeps exiting, so kubectl fails. `crictl logs` of the kube-apiserver container shows the etcd connection errors; `--listen-client-urls` in `etcd.yaml` shows the right port.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=apiserver-etcd-certfile -->
#### API server etcd client certificate path is wrong (`apiserver-etcd-certfile`)

`--etcd-certfile` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt`, which does not exist. The certificate lives one directory up, in `/etc/kubernetes/pki/`. The API server exits at startup with "no such file or directory", which `crictl logs` shows.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=etcd-cert-path -->
#### etcd server certificate path is wrong (`etcd-cert-path`)

`--cert-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `server.cert` instead of `server.crt`. etcd exits at startup, and the API server loses its storage with it. kubectl fails, the kube-apiserver logs show etcd connection errors, and `crictl logs` of the etcd container shows the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\.cert$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-command -->
#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=controller-manager-kubeconfig -->
#### Controller manager kubeconfig path is wrong (`controller-manager-kubeconfig`)

`--kubeconfig` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` points at `controller-manager.config` instead of `controller-manager.conf`. The controller manager exits at startup, so the Deployment is scaled but no ReplicaSet creates Pods (`kubectl get deploy` shows 0 of 2, with no Pods at all). Its logs show the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/controller-manager)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubelet-client-cert -->
#### controlplane kubelet client certificate path is wrong (`kubelet-client-cert`)

`client-certificate` in `/etc/kubernetes/kubelet.conf` points at `/var/lib/kubelet/pki/kubelet-client.pem`, which does not exist, so the kubelet on controlplane cannot authenticate and exits. The node turns `NotReady` while the static pods keep running. `journalctl -u kubelet` shows the missing file; `ls /var/lib/kubelet/pki` shows `kubelet-client-current.pem`. Fix the path and restart the kubelet.

```bash
sed -i -E 's#^([[:space:]]*client-certificate: /var/lib/kubelet/pki/)kubelet-client.pem$#\1kubelet-client-current.pem#' /etc/kubernetes/kubelet.conf
grep -qE -- 'client-certificate: /var/lib/kubelet/pki/kubelet-client-current.pem$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubelet-static-pod-path -->
#### controlplane kubelet watches the wrong static pod directory (`kubelet-static-pod-path`)

`staticPodPath` in `/var/lib/kubelet/config.yaml` is `/etc/kubernetes/manifest`, a directory that does not exist. The kubelet runs, but it finds no static pod manifests and stops etcd, the API server, the scheduler and the controller manager, so kubectl fails. `crictl ps` on controlplane shows no control plane containers, and `journalctl -u kubelet` mentions the missing path. Set it back to `/etc/kubernetes/manifests` and restart the kubelet.

```bash
sed -i -E 's#^staticPodPath: /etc/kubernetes/manifest$#staticPodPath: /etc/kubernetes/manifests#' /var/lib/kubelet/config.yaml
grep -qE -- '^staticPodPath: /etc/kubernetes/manifests$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

### Question 2: Pod ${Q2_CLAIM}-app stuck

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=storageclass-mismatch -->
#### Claim asks for another StorageClass (`storageclass-mismatch`)

The claim asks for StorageClass `fast`, which neither exists nor matches `${Q2_CLAIM}-pv` (`manual`), so it stays `Pending`. Re-create it with `storageClassName: manual`.

```bash
kubectl -n "${Q2_NS}" delete pod "${Q2_CLAIM}-app" --wait=true
kubectl -n "${Q2_NS}" delete pvc "${Q2_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q2_CLAIM}"'","namespace":"'"${Q2_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q2_CLAIM}"'-app","namespace":"'"${Q2_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q2_CLAIM}"'"}}]}}]}'
kubectl -n "${Q2_NS}" wait --for=condition=Ready "pod/${Q2_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

<!-- fault Q2_FAULT=access-mode-mismatch -->
#### Claim asks for ReadWriteMany (`access-mode-mismatch`)

The claim asks for `ReadWriteMany`, but `${Q2_CLAIM}-pv` only offers `ReadWriteOnce`, so nothing binds. Re-create it with `ReadWriteOnce`.

```bash
kubectl -n "${Q2_NS}" delete pod "${Q2_CLAIM}-app" --wait=true
kubectl -n "${Q2_NS}" delete pvc "${Q2_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q2_CLAIM}"'","namespace":"'"${Q2_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q2_CLAIM}"'-app","namespace":"'"${Q2_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q2_CLAIM}"'"}}]}}]}'
kubectl -n "${Q2_NS}" wait --for=condition=Ready "pod/${Q2_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

<!-- fault Q2_FAULT=claim-too-large -->
#### Claim larger than the volume (`claim-too-large`)

The claim requests `2Gi` and `${Q2_CLAIM}-pv` holds only `1Gi`, so it can never bind. Re-create it requesting `500Mi`.

```bash
kubectl -n "${Q2_NS}" delete pod "${Q2_CLAIM}-app" --wait=true
kubectl -n "${Q2_NS}" delete pvc "${Q2_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q2_CLAIM}"'","namespace":"'"${Q2_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q2_CLAIM}"'-app","namespace":"'"${Q2_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q2_CLAIM}"'"}}]}}]}'
kubectl -n "${Q2_NS}" wait --for=condition=Ready "pod/${Q2_CLAIM}-app" --timeout=180s
```
<!-- /fault -->

### Question 3: Pod ${Q3_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: "${Q3_NAME}"
  namespace: "${Q3_NS}"
spec:
  containers:
    - name: main
      image: "${Q3_IMAGE}"
      command:
        - sleep
        - 1d
      securityContext:
        capabilities:
          drop:
            - ALL
          add:
            - "${Q3_CAPS_CAP}"
      livenessProbe:
        exec:
          command:
            - ls
            - /
        periodSeconds: ${Q3_PROBE_PERIOD}
EOF
kubectl -n "${Q3_NS}" wait --for=condition=Ready "pod/${Q3_NAME}" --timeout=180s
kubectl -n "${Q3_NS}" set image "pod/${Q3_NAME}" "main=${Q3_UPDATE_IMAGE}"
timeout 180 bash -c 'until [[ "$(kubectl -n "$0" get pod "$1" -o jsonpath="{.status.containerStatuses[?(@.name==\"main\")].restartCount}")" -ge 1 ]] 2>/dev/null; do sleep 2; done' "${Q3_NS}" "${Q3_NAME}"
kubectl -n "${Q3_NS}" wait --for=condition=Ready "pod/${Q3_NAME}" --timeout=120s
kubectl -n "${Q3_NS}" label pod "${Q3_NAME}" "${Q3_LABEL_KEY}=${Q3_LABEL_VALUE}" --overwrite
```

### Question 4: Unhealthy Deployment ${Q4_APP}

This run's fault: **`${Q4_FAULT}`**.

<!-- fault Q4_FAULT=oom-killed -->
#### Memory limit too low (OOMKilled) (`oom-killed`)

The memory limit was lowered to 4Mi, so the container is killed as soon as it starts: `describe pod` shows `OOMKilled` (or a start error) and the restart count climbs. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q4_NS}" set resources "deployment/${Q4_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=image-pull -->
#### Image tag does not exist (ImagePullBackOff) (`image-pull`)

The image was changed to `nginx:1.27-alpne`, which does not exist: the Pods sit in `ErrImagePull` / `ImagePullBackOff`. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q4_NS}" set image "deployment/${Q4_APP}" web=nginx:1.27-alpine
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=bad-command -->
#### Broken command (CrashLoopBackOff) (`bad-command`)

A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=configmap-key -->
#### ConfigMap key missing (CreateContainerConfigError) (`configmap-key`)

ConfigMap `${Q4_APP}-config` has the key `mod` instead of `mode`, so the containers cannot be created: `CreateContainerConfigError`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.

```bash
kubectl -n "${Q4_NS}" patch configmap "${Q4_APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${Q4_NS}" rollout restart "deployment/${Q4_APP}"
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=liveness-port -->
#### Liveness probe on the wrong port (`liveness-port`)

The liveness probe checks port 8080, where nothing listens, so the kubelet keeps killing healthy containers: the restart count climbs and the Events show `Liveness probe failed`. Point the probe back at port 80.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"tcpSocket":{"port":80}}}]}}}}'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=readiness-path -->
#### Readiness probe on the wrong path (`readiness-path`)

The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=requests-too-large -->
#### CPU request larger than any node (Pending) (`requests-too-large`)

The CPU request was raised to 64 cores, so no node can fit a Pod: they stay `Pending` with `Insufficient cpu` in the Events. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q4_NS}" set resources "deployment/${Q4_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=node-selector -->
#### nodeSelector matching no node (Pending) (`node-selector`)

A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

### Question 5: ${Q5_APP} unreachable through the ingress

This run's fault: **`${Q5_FAULT}`**.

<!-- fault Q5_FAULT=ingress-service-name -->
#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `${Q5_APP}-svc`, which does not exist, so Traefik has nothing to send `www.${Q5_NS}.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `${Q5_APP}`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"'"${Q5_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-service-port -->
#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q5_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-class -->
#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.${Q5_NS}.lab`. Set the class back to `traefik`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=ingress-path -->
#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q5_NS}" patch ingress "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q5_NS}" patch httproute "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q5_NS}" patch httproute "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q5_FAULT=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q5_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q5_NS}" patch httproute "${Q5_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

### Question 6: Unhealthy worker

This run's fault: **`${Q6_FAULT}`** on `${Q6_NODE}`.

<!-- fault Q6_FAULT=kubelet-stopped -->
#### kubelet stopped and disabled (`kubelet-stopped`)

The kubelet was stopped and disabled, so the node stops sending heartbeats and turns `NotReady`. `systemctl status kubelet` shows it inactive. `systemctl enable --now kubelet` fixes it now and after a reboot.

On the broken worker:

```bash
systemctl enable --now kubelet
```
<!-- /fault -->

<!-- fault Q6_FAULT=containerd-stopped -->
#### containerd stopped and disabled (`containerd-stopped`)

The container runtime was stopped and disabled. The kubelet keeps running but reports `container runtime is down` / `NotReady`, and its log is full of CRI connection errors. `systemctl enable --now containerd` fixes it.

On the broken worker:

```bash
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-binary-path -->
#### kubelet unit points at the wrong binary (`kubelet-binary-path`)

The kubeadm drop-in (`10-kubeadm.conf`) starts `/usr/local/bin/kubelet`, which does not exist, so the service fails with `status=203/EXEC`. `systemctl cat kubelet` shows the path; `which kubelet` shows the real one. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q6_FAULT=cordoned -->
#### Node cordoned (`cordoned`)

The node is `Ready` but cordoned (`SchedulingDisabled`), so no new Pods land on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q6_NODE}"
```
<!-- /fault -->

<!-- fault Q6_FAULT=stray-taint -->
#### Stray NoSchedule taint (`stray-taint`)

A `maintenance=true:NoSchedule` taint keeps every Pod without a matching toleration off the node, including the probe Pod. `kubectl describe node` lists it under Taints; remove it with `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q6_NODE}" maintenance-
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-config-invalid -->
#### kubelet config has the wrong kind (`kubelet-config-invalid`)

`/var/lib/kubelet/config.yaml` says `kind: KubeletConfig`. The kubelet cannot decode its own config and exits at start (no kind "KubeletConfig" is registered), so the node turns `NotReady`. `journalctl -u kubelet` shows the error. Set `kind: KubeletConfiguration` again and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's/^kind: KubeletConfig$/kind: KubeletConfiguration/' /var/lib/kubelet/config.yaml
grep -qE -- '^kind: KubeletConfiguration$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-client-ca -->
#### kubelet client CA file missing (`kubelet-client-ca`)

`authentication.x509.clientCAFile` in `/var/lib/kubelet/config.yaml` points at `/etc/kubernetes/pki/ca.pem`, which does not exist, so the kubelet exits with "unable to load client CA file". `ls /etc/kubernetes/pki` shows the real `ca.crt`. Fix the path and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#clientCAFile: /etc/kubernetes/pki/ca\.pem$#clientCAFile: /etc/kubernetes/pki/ca.crt#' /var/lib/kubelet/config.yaml
grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca\.crt$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-api-port -->
#### kubelet kubeconfig uses the wrong API port (`kubelet-api-port`)

The kubelet runs, but `/etc/kubernetes/kubelet.conf` points it at port `6444` of the API server, so every request fails with "connection refused" and the node stops heartbeating. `journalctl -u kubelet` shows the URL; the API server listens on `6443` (compare `~/.kube/config`). Fix the port and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*server: https://.*):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
grep -qE -- 'server: https://.*:6443$' /etc/kubernetes/kubelet.conf || { echo "could not edit /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q6_FAULT=kubelet-extra-args -->
#### kubelet started with an unknown flag (`kubelet-extra-args`)

`/etc/default/kubelet` adds `--pod-max-pids-limit=100` to `KUBELET_EXTRA_ARGS`. No such flag exists (the real one is `--pod-max-pids`), so the kubelet exits with "unknown flag" right after start. `systemctl cat kubelet` shows the drop-in reads that file. Remove the flag and restart the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q6.kubelet-default" /etc/default/kubelet
systemctl restart kubelet
```
<!-- /fault -->
