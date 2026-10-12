## Solution

### Question 1: Unhealthy Deployment ${Q1_APP}

This run's fault: **`${Q1_FAULT}`**.

Every fault this question can roll:

#### Image tag does not exist (ImagePullBackOff) (`image-pull`)

The image was changed to `nginx:1.27-alpne`, which does not exist: the Pods sit in `ErrImagePull` / `ImagePullBackOff`. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q1_NS}" set image "deployment/${Q1_APP}" web=nginx:1.27-alpine
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### Broken command (CrashLoopBackOff) (`bad-command`)

A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### ConfigMap key missing (CreateContainerConfigError) (`configmap-key`)

ConfigMap `${Q1_APP}-config` has the key `mod` instead of `mode`, so the containers cannot be created: `CreateContainerConfigError`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.

```bash
kubectl -n "${Q1_NS}" patch configmap "${Q1_APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

### Question 2: Service ${Q2_APP} unreachable

This run's fault: **`${Q2_FAULT}`**.

Every fault this question can roll:

#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=${Q2_APP}-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=${Q2_APP}`.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" -p '{"spec":{"selector":{"app":"'"${Q2_APP}"'"}}}'
```

#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```

### Question 3: Pod ${Q3_CLAIM}-app stuck

This run's fault: **`${Q3_FAULT}`**.

Every fault this question can roll:

#### Claim asks for another StorageClass (`storageclass-mismatch`)

The claim asks for StorageClass `fast`, which neither exists nor matches `${Q3_CLAIM}-pv` (`manual`), so it stays `Pending`. Re-create it with `storageClassName: manual`.

```bash
kubectl -n "${Q3_NS}" delete pod "${Q3_CLAIM}-app" --wait=true
kubectl -n "${Q3_NS}" delete pvc "${Q3_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q3_CLAIM}"'","namespace":"'"${Q3_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q3_CLAIM}"'-app","namespace":"'"${Q3_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q3_CLAIM}"'"}}]}}]}'
kubectl -n "${Q3_NS}" wait --for=condition=Ready "pod/${Q3_CLAIM}-app" --timeout=180s
```

#### Claim asks for ReadWriteMany (`access-mode-mismatch`)

The claim asks for `ReadWriteMany`, but `${Q3_CLAIM}-pv` only offers `ReadWriteOnce`, so nothing binds. Re-create it with `ReadWriteOnce`.

```bash
kubectl -n "${Q3_NS}" delete pod "${Q3_CLAIM}-app" --wait=true
kubectl -n "${Q3_NS}" delete pvc "${Q3_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q3_CLAIM}"'","namespace":"'"${Q3_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q3_CLAIM}"'-app","namespace":"'"${Q3_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q3_CLAIM}"'"}}]}}]}'
kubectl -n "${Q3_NS}" wait --for=condition=Ready "pod/${Q3_CLAIM}-app" --timeout=180s
```

#### Claim larger than the volume (`claim-too-large`)

The claim requests `2Gi` and `${Q3_CLAIM}-pv` holds only `1Gi`, so it can never bind. Re-create it requesting `500Mi`.

```bash
kubectl -n "${Q3_NS}" delete pod "${Q3_CLAIM}-app" --wait=true
kubectl -n "${Q3_NS}" delete pvc "${Q3_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q3_CLAIM}"'","namespace":"'"${Q3_NS}"'"},"spec":{"storageClassName":"manual","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}},{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q3_CLAIM}"'-app","namespace":"'"${Q3_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q3_CLAIM}"'"}}]}}]}'
kubectl -n "${Q3_NS}" wait --for=condition=Ready "pod/${Q3_CLAIM}-app" --timeout=180s
```

### Question 4: ${Q4_APP} unreachable through the ingress

This run's fault: **`${Q4_FAULT}`**.

Every fault this question can roll:

#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q4_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q4_NS}" patch ingress "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```

#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q4_NS}" patch ingress "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```

#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q4_NS}" patch httproute "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```

#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q4_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q4_NS}" patch httproute "${Q4_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```

### Question 5: Unhealthy worker

This run's fault: **`${Q5_FAULT}`** on `${Q5_NODE}`.

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

### Question 6: Control plane after maintenance

This run's fault: **`${Q6_FAULT}`**.

Every fault this question can roll:

#### API server talks to the etcd peer port (`apiserver-etcd-port`)

`--etcd-servers` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at port `2380`, etcd's peer port, instead of the client port `2379`. The API server cannot reach its storage and keeps exiting, so kubectl fails. `crictl logs` of the kube-apiserver container shows the etcd connection errors; `--listen-client-urls` in `etcd.yaml` shows the right port.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```

#### API server etcd client certificate path is wrong (`apiserver-etcd-certfile`)

`--etcd-certfile` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt`, which does not exist. The certificate lives one directory up, in `/etc/kubernetes/pki/`. The API server exits at startup with "no such file or directory", which `crictl logs` shows.

```bash
sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```

#### etcd server certificate path is wrong (`etcd-cert-path`)

`--cert-file` in `/etc/kubernetes/manifests/etcd.yaml` points at `server.cert` instead of `server.crt`. etcd exits at startup, and the API server loses its storage with it. kubectl fails, the kube-apiserver logs show etcd connection errors, and `crictl logs` of the etcd container shows the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\.cert$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
```

#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```

#### Controller manager kubeconfig path is wrong (`controller-manager-kubeconfig`)

`--kubeconfig` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` points at `controller-manager.config` instead of `controller-manager.conf`. The controller manager exits at startup, so the Deployment is scaled but no ReplicaSet creates Pods (`kubectl get deploy` shows 0 of 2, with no Pods at all). Its logs show the missing file.

```bash
sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/controller-manager)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```

#### controlplane kubelet client certificate path is wrong (`kubelet-client-cert`)

`client-certificate` in `/etc/kubernetes/kubelet.conf` points at `/var/lib/kubelet/pki/kubelet-client.pem`, which does not exist, so the kubelet on controlplane cannot authenticate and exits. The node turns `NotReady` while the static pods keep running. `journalctl -u kubelet` shows the missing file; `ls /var/lib/kubelet/pki` shows `kubelet-client-current.pem`. Fix the path and restart the kubelet.

```bash
sed -i -E 's#^([[:space:]]*client-certificate: /var/lib/kubelet/pki/)kubelet-client.pem$#\1kubelet-client-current.pem#' /etc/kubernetes/kubelet.conf
grep -qE -- 'client-certificate: /var/lib/kubelet/pki/kubelet-client-current.pem$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet
```
