## Solution

### Question 1: CronJob ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
spec:
  schedule: "${Q1_SCHEDULE}"
  jobTemplate:
    spec:
      completions: ${Q1_COMPLETIONS}
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: "${Q1_NAME}"
              image: busybox:1.36
              command:
                - sh
                - -c
                - date; echo done
EOF
kubectl -n "${Q1_NS}" patch "cronjob/${Q1_NAME}" -p '{"spec":{"suspend":true}}'
kubectl -n "${Q1_NS}" create job "${Q1_NAME}-manual" --from="cronjob/${Q1_NAME}"
kubectl -n "${Q1_NS}" wait --for=condition=Complete "job/${Q1_NAME}-manual" --timeout=240s
```

### Question 2: Cluster certificates

```bash
mkdir -p "$(dirname "${Q2_EXPIRY}")"
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate | cut -d= -f2 > "${Q2_EXPIRY}"
kubeadm certs renew apiserver
mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/kube-apiserver.yaml
for _ in $(seq 1 60); do
  [[ -z "$(crictl ps -q --name kube-apiserver 2>/dev/null)" ]] && break
  sleep 2
done
mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
for _ in $(seq 1 240); do
  [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
  sleep 3
done
```

### Question 3: Worker after a configuration change

**The healthy setup**

- the kubelet unit drop-in loads `/var/lib/kubelet/config.yaml` and `/etc/kubernetes/kubelet.conf`, as kubeadm wrote them
- `/etc/kubernetes/kubelet.conf` points at the API server on port `6443`
- `/var/lib/kubelet/config.yaml` keeps the kubeadm values: the containerd socket, `cgroupDriver: systemd`, the cluster CA, no extra TLS files, and the default eviction thresholds
- `/etc/containerd/config.toml` sets `SystemdCgroup = true` for the runc runtime

This run's fault: **`${Q3_FAULT}`** on `${Q3_NODE}`.

<!-- fault Q3_FAULT=kubelet-client-ca -->
#### kubelet client CA file path is wrong (`kubelet-client-ca`)

`authentication.x509.clientCAFile` in `/var/lib/kubelet/config.yaml` points at `/etc/kubernetes/pki/ca.pem`, which does not exist, so the kubelet exits at startup (`unable to load client CA file`) and systemd keeps restarting it. `ls /etc/kubernetes/pki` shows `ca.crt`. Fix the path and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*clientCAFile: /etc/kubernetes/pki/)ca\.pem$#\1ca.crt#' /var/lib/kubelet/config.yaml
grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca.crt$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=runtime-endpoint -->
#### kubelet points at the wrong container runtime socket (`runtime-endpoint`)

`containerRuntimeEndpoint` in `/var/lib/kubelet/config.yaml` points at the CRI-O socket `/var/run/crio/crio.sock`, but the node runs containerd. containerd itself is healthy, yet the kubelet cannot reach a runtime and fails to start. `journalctl -u kubelet` names the missing socket; `/etc/crictl.yaml` or `ls /var/run/containerd` shows the right one. Fix the endpoint and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^containerRuntimeEndpoint: unix:///var/run/crio/crio\.sock$#containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock#' /var/lib/kubelet/config.yaml
grep -qE -- '^containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-config-flag -->
#### kubelet unit loads a configuration file that does not exist (`kubelet-config-flag`)

The kubeadm drop-in (`10-kubeadm.conf`) starts the kubelet with `--config=/var/lib/kubelet/kubelet-config.yaml`, which does not exist, so it exits with `failed to load Kubelet config file`. `systemctl cat kubelet` shows the flag and `ls /var/lib/kubelet` shows `config.yaml`. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i -E 's#--config=/var/lib/kubelet/kubelet-config\.yaml#--config=/var/lib/kubelet/config.yaml#' "$dropin"
grep -qE -- '--config=/var/lib/kubelet/config.yaml' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-kubeconfig-flag -->
#### kubelet unit loads a kubeconfig that does not exist (`kubelet-kubeconfig-flag`)

The kubeadm drop-in starts the kubelet with `--kubeconfig=/etc/kubernetes/kubelet.config`. That file does not exist and the bootstrap kubeconfig is long gone, so the kubelet exits right after start and the node turns `NotReady`. `systemctl cat kubelet` shows the flag; `ls /etc/kubernetes` shows the real `kubelet.conf`. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i -E 's#--kubeconfig=/etc/kubernetes/kubelet\.config#--kubeconfig=/etc/kubernetes/kubelet.conf#' "$dropin"
grep -qE -- '--kubeconfig=/etc/kubernetes/kubelet.conf' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-serving-cert -->
#### kubelet serving certificate file missing (`kubelet-serving-cert`)

`/var/lib/kubelet/config.yaml` sets `tlsCertFile` and `tlsPrivateKeyFile` to `/var/lib/kubelet/pki/kubelet-server.*`, which do not exist, so the kubelet cannot load its serving certificate and exits at start. `journalctl -u kubelet` names the file, and `ls /var/lib/kubelet/pki` shows only the self-generated `kubelet.crt`/`kubelet.key` and the client certificates. Remove both lines (the kubelet then uses its self-signed certificate) and restart it.

On the broken worker:

```bash
sed -i -E '/^tls(CertFile|PrivateKeyFile): /d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-eviction-hard -->
#### kubelet evictionHard memory threshold is absurd (`kubelet-eviction-hard`)

`/var/lib/kubelet/config.yaml` sets `evictionHard.memory.available: "99%"`, so the kubelet constantly reports MemoryPressure and evicts workload Pods even though the node stays Ready. `kubectl describe node` shows the pressure condition and eviction events. Restore the previous kubelet config (or remove that evictionHard entry) and restart the kubelet.

On the broken worker:

```bash
if [[ -f /var/lib/kubelet/config.yaml.cka-bak ]]; then cp -a /var/lib/kubelet/config.yaml.cka-bak /var/lib/kubelet/config.yaml; else
  sed -i '/^evictionHard:/,/^[^[:space:]]/{ /^evictionHard:/d; /^[[:space:]]/d; }' /var/lib/kubelet/config.yaml || true
  sed -i '/memory.available: "99%"/d' /var/lib/kubelet/config.yaml || true
fi
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q3_FAULT=kubelet-cgroup-driver -->
#### containerd cgroup driver is invalid (`kubelet-cgroup-driver`)

`SystemdCgroup` in `/etc/containerd/config.toml` is the string `"invalid"`, so containerd cannot load its config and never starts. Kubelet 1.37 asks containerd which cgroup driver to use, and exits when the runtime does not answer, so the node turns `NotReady`. `journalctl -u containerd` names the field; a healthy worker has `SystemdCgroup = true`. Set that, then restart containerd and the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*SystemdCgroup = )"invalid"[[:space:]]*$#\1true#' /etc/containerd/config.toml
grep -qE -- '^[[:space:]]*SystemdCgroup = true$' /etc/containerd/config.toml || { echo "could not modify /etc/containerd/config.toml" >&2; exit 1; }
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

### Question 4: HTTPS Gateway

```bash
kubectl -n ${Q4_NS} create secret tls web-tls --cert=/opt/course/tls/${Q4_NS}/tls.crt --key=/opt/course/tls/${Q4_NS}/tls.key
kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: web-gw
  namespace: ${Q4_NS}
spec:
  gatewayClassName: traefik
  listeners:
    - name: https
      protocol: HTTPS
      port: 8443
      hostname: secure.${Q4_NS}.lab
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: web-tls
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: ${Q4_NS}
spec:
  parentRefs:
    - name: web-gw
      sectionName: https
  hostnames: [secure.${Q4_NS}.lab]
  rules:
    - matches: [{ path: { type: PathPrefix, value: / } }]
      backendRefs: [{ name: web, port: 80 }]
EOF
```

### Question 5: kubectl stopped working

**The healthy setup**

- `/etc/kubernetes/manifests/kube-apiserver.yaml` keeps the kubeadm flags: secure port `6443`, bind address `0.0.0.0`, and the CA, serving certificate and key from `/etc/kubernetes/pki`
- both user kubeconfigs match `/etc/kubernetes/admin.conf`: server `https://<controlplane-ip>:6443`, the cluster CA, a matching client certificate and key, a current context that exists, and readable file permissions

This run broke 2 things: **`${Q5_FAULT}`**, **`${Q5_FAULT_2}`**. Fix them in the order below.

**Problem 1: the user kubeconfigs**

<!-- fault Q5_FAULT=kubeconfig-server-port -->
#### User kubeconfigs point at the wrong port (`kubeconfig-server-port`)

`server:` in `/root/.kube/config` and `/home/ubuntu/.kube/config` uses port `6433` instead of `6443`, so kubectl gets `connection refused` even though the API server is healthy (`curl -k https://127.0.0.1:6443/readyz` answers `ok`). Fix the port in both files, or copy `/etc/kubernetes/admin.conf` over them.

```bash
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /root/.kube/config
grep -qE -- 'server: https://[^[:space:]]+:6443$' /root/.kube/config || { echo "could not modify /root/.kube/config" >&2; exit 1; }
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /home/ubuntu/.kube/config
grep -qE -- 'server: https://[^[:space:]]+:6443$' /home/ubuntu/.kube/config || { echo "could not modify /home/ubuntu/.kube/config" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q5_FAULT=kubeconfig-wrong-ca -->
#### User kubeconfigs trust the wrong CA (`kubeconfig-wrong-ca`)

`certificate-authority-data` in both user kubeconfigs holds the front-proxy CA (`/etc/kubernetes/pki/front-proxy-ca.crt`) instead of the cluster CA, so kubectl rejects the API server's certificate: `x509: certificate signed by unknown authority`. Put `/etc/kubernetes/pki/ca.crt` back (`kubectl config set clusters.kubernetes.certificate-authority-data $(base64 -w0 /etc/kubernetes/pki/ca.crt)`), or copy `/etc/kubernetes/admin.conf` over them.

```bash
for f in /root/.kube/config /home/ubuntu/.kube/config; do
  kubectl config --kubeconfig "$f" set clusters.kubernetes.certificate-authority-data "$(base64 -w0 /etc/kubernetes/pki/ca.crt)" >/dev/null
done
```
<!-- /fault -->

<!-- fault Q5_FAULT=kubeconfig-current-context -->
#### User kubeconfigs use a context that does not exist (`kubeconfig-current-context`)

`current-context` in both user kubeconfigs is `admin@production`, which is not defined in them, so kubectl fails with "context was not found for specified context". The API server is healthy. `kubectl config get-contexts` lists the real context: switch back with `kubectl config use-context <name>` (as root and as ubuntu).

```bash
for f in /root/.kube/config /home/ubuntu/.kube/config; do
  kubectl config --kubeconfig "$f" use-context "$(kubectl config --kubeconfig "$f" get-contexts -o name | head -1)" >/dev/null
done
```
<!-- /fault -->

<!-- fault Q5_FAULT=kubeconfig-client-key -->
#### User kubeconfigs hold a key that does not match the certificate (`kubeconfig-client-key`)

`client-key-data` of the user in both user kubeconfigs is the key of `/etc/kubernetes/pki/apiserver-kubelet-client.key`, which does not belong to the user's `client-certificate-data`. kubectl fails before it sends anything ("tls: private key does not match public key"). The admin credentials are intact in `/etc/kubernetes/admin.conf`: copy it over `/root/.kube/config` and `/home/ubuntu/.kube/config` (keeping ubuntu as the owner), or copy its `client-key-data` into them.

```bash
cp -a "/var/tmp/cka-q5.kubeconfig-0" /root/.kube/config
cp -a "/var/tmp/cka-q5.kubeconfig-1" /home/ubuntu/.kube/config
```
<!-- /fault -->

<!-- fault Q5_FAULT=kubeconfig-server-host -->
#### User kubeconfigs name an API host that no longer exists (`kubeconfig-server-host`)

`server:` in both user kubeconfigs is `https://controlplane-old:6443`, a name left over from before the node was renamed. Nothing resolves it, so kubectl fails with "no such host" while the API server is healthy (`curl -k https://127.0.0.1:6443/readyz`). Restore the real `server:` from `/etc/kubernetes/admin.conf`, or copy that file over the kubeconfigs.

```bash
cp -a "/var/tmp/cka-q5.kubeconfig-0" /root/.kube/config
cp -a "/var/tmp/cka-q5.kubeconfig-1" /home/ubuntu/.kube/config
```
<!-- /fault -->

<!-- fault Q5_FAULT=kubeconfig-permissions -->
#### ubuntu's kubeconfig is owned by root and unreadable for ubuntu (`kubeconfig-permissions`)

`/home/ubuntu/.kube/config` belongs to `root` with mode `600`, as happens after `sudo cp /etc/kubernetes/admin.conf ~/.kube/config` without the `chown` kubeadm prints. kubectl as root works; as ubuntu it fails with "permission denied" (`ls -l ~/.kube/config`). Give the file back to ubuntu: `sudo chown ubuntu:ubuntu /home/ubuntu/.kube/config`.

```bash
chown ubuntu:ubuntu /home/ubuntu/.kube/config
chmod 600 /home/ubuntu/.kube/config
```
<!-- /fault -->

**Problem 2: the API server**

<!-- fault Q5_FAULT_2=apiserver-cert-file -->
#### An API server certificate flag points at a file that does not exist (`apiserver-cert-file`)

In this run `--${Q5_APISERVER_CERT}` in `/etc/kubernetes/manifests/kube-apiserver.yaml` names a file that does not exist, so the API server exits at startup and kubectl gets `connection refused`, while `curl -k https://127.0.0.1:6443/readyz` gets nothing either. `crictl logs` of the last kube-apiserver container names the missing file, and `ls /etc/kubernetes/pki` shows the real one. Every flag this fault can break:

- `--client-ca-file`: `/etc/kubernetes/pki/ca.crt` (broken: `/etc/kubernetes/pki/ca.cert`)
- `--tls-cert-file`: `/etc/kubernetes/pki/apiserver.crt` (broken: `/etc/kubernetes/pki/apiserver.cert`)

```bash
case "${Q5_APISERVER_CERT}" in
  client-ca-file)
    sed -i -E 's#^([[:space:]]*- --client-ca-file=)/etc/kubernetes/pki/ca.cert$#\1/etc/kubernetes/pki/ca.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --client-ca-file=/etc/kubernetes/pki/ca.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  tls-cert-file)
    sed -i -E 's#^([[:space:]]*- --tls-cert-file=)/etc/kubernetes/pki/apiserver.cert$#\1/etc/kubernetes/pki/apiserver.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --tls-cert-file=/etc/kubernetes/pki/apiserver.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q5_APISERVER_CERT}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q5_FAULT_2=apiserver-secure-port -->
#### API server listens on the wrong port (`apiserver-secure-port`)

`--secure-port` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `6444`, so nothing answers on `6443`: kubectl, the kubelets and the other components get `connection refused`, and the API server's own probes (which target the `probe-port`, 6443) fail until the kubelet restarts it. `ss -ltnp` shows it listening on 6444. Set the port back to `6443`.

```bash
sed -i -E 's#^([[:space:]]*- --secure-port=)6444$#\16443#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --secure-port=6443$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q5_FAULT_2=apiserver-manifest-yaml -->
#### API server manifest is not valid YAML (`apiserver-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-apiserver.yaml` is indented by three spaces instead of four, which makes the file invalid YAML. The kubelet cannot parse the manifest, so it drops the kube-apiserver static pod: no container at all in `crictl ps -a`, and `journalctl -u kubelet` reports the manifest it could not decode. Fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-apiserver:)#    image: \1#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '^    image: registry.k8s.io/kube-apiserver:' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

### Question 6: Install a service on ${Q6_NODE}

```bash
runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new ${Q6_NODE} sudo bash -s <<'CKA_NODE_EOF'
dpkg -i /opt/course/pkg/node-health-agent_1.0.0_all.deb
systemctl daemon-reload
systemctl enable --now node-health-agent
CKA_NODE_EOF
```

### Question 7: Back up etcd

```bash
mkdir -p "$(dirname "${Q7_BACKUP}")"
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save "${Q7_BACKUP}"
mkdir -p "$(dirname "${Q7_STATUS_FILE}")"
ETCDCTL_API=3 etcdctl snapshot status "${Q7_BACKUP}" -w table > "${Q7_STATUS_FILE}"
```

### Question 8: Pod ${Q8_CLAIM}-app never starts

**The healthy setup**

- StorageClass `${Q8_CLAIM}-local`: provisioner `rancher.io/local-path`, `WaitForFirstConsumer`, reclaim `Delete`
- PVC `${Q8_CLAIM}` in `${Q8_NS}`: `500Mi`, `ReadWriteOnce`, `storageClassName: ${Q8_CLAIM}-local`
- Pod `${Q8_CLAIM}-app` (`busybox:1.36`, `sleep 1d`) mounts only that claim, at `/data`, and no other Pod uses it

This run's fault: **`${Q8_FAULT}`**.

<!-- fault Q8_FAULT=provisioner-typo -->
#### StorageClass names a provisioner that does not exist (`provisioner-typo`)

StorageClass `${Q8_CLAIM}-local` names provisioner `rancher.io/localpath`. Nothing serves that name, so the claim stays `Pending` with "waiting for a volume to be created either by the external provisioner 'rancher.io/localpath'". The provisioner field cannot be changed: re-create the class with `rancher.io/local-path` (the name the running provisioner and the built-in `local-path` class use), then re-create the claim and the Pod.

```bash
kubectl -n "${Q8_NS}" delete pod --all --wait=true
kubectl -n "${Q8_NS}" delete pvc "${Q8_CLAIM}" --wait=true
kubectl delete storageclass "${Q8_CLAIM}-local"
kubectl apply -f - <<< '{"apiVersion":"storage.k8s.io/v1","kind":"StorageClass","metadata":{"name":"'"${Q8_CLAIM}-local"'"},"provisioner":"rancher.io/local-path","volumeBindingMode":"WaitForFirstConsumer","reclaimPolicy":"Delete"}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q8_CLAIM}"'","namespace":"'"${Q8_NS}"'"},"spec":{"storageClassName":"'"${Q8_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q8_CLAIM}-app"'","namespace":"'"${Q8_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q8_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=provisioner-down -->
#### The local-path provisioner is scaled to zero (`provisioner-down`)

The class, the claim and the Pod are all right, but Deployment `local-path-provisioner` in `local-path-storage` has `0` replicas, so nobody creates the volume: the claim stays `Pending` with "waiting for a volume to be created either by the external provisioner 'rancher.io/local-path'", and nothing more happens. The class names who provisions; check that it runs: `kubectl -n local-path-storage get deploy,pods`. Scale it back to `1`.

```bash
kubectl scale -n local-path-storage deployment/local-path-provisioner --replicas=1
```
<!-- /fault -->

<!-- fault Q8_FAULT=no-class -->
#### Claim names no StorageClass and there is no default (`no-class`)

The claim names no `storageClassName` and the cluster has no default class, so nothing provisions it: it waits for a static PV that never comes ("no persistent volumes available for this claim and no storage class is set"). The task rules out a default class, so re-create the claim with `storageClassName: ${Q8_CLAIM}-local`, then the Pod.

```bash
kubectl -n "${Q8_NS}" delete pod "${Q8_CLAIM}-app" --wait=true
kubectl -n "${Q8_NS}" delete pvc "${Q8_CLAIM}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q8_CLAIM}"'","namespace":"'"${Q8_NS}"'"},"spec":{"storageClassName":"'"${Q8_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q8_CLAIM}-app"'","namespace":"'"${Q8_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q8_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=rwop-taken -->
#### ReadWriteOncePod claim already used by another Pod (`rwop-taken`)

The claim's access mode is `ReadWriteOncePod`: only one Pod in the whole cluster may use it, and Pod `${Q8_CLAIM}-backup` already does. `${Q8_CLAIM}-app` stays `Pending`; the scheduler says "node has pod using PersistentVolumeClaim with the same name and ReadWriteOncePod access mode". Remove `${Q8_CLAIM}-backup` (a leftover), or re-create the claim with `ReadWriteOnce` if both Pods must share it on one node.

```bash
kubectl -n "${Q8_NS}" delete pod "${Q8_CLAIM}-backup" --ignore-not-found --wait=true
```
<!-- /fault -->

<!-- fault Q8_FAULT=hostpath-missing -->
#### Extra hostPath volume requires a directory that does not exist (`hostpath-missing`)

Besides its claim, the Pod mounts hostPath `/var/log/${Q8_CLAIM}-app` with `type: Directory`, which requires the directory to exist on the node. It does not, so the Pod stays in `ContainerCreating` with "hostPath type check failed: ... is not a directory" under Events, although the claim is Bound. Re-create the Pod with `type: DirectoryOrCreate` (or create the directory on the node).

```bash
kubectl -n "${Q8_NS}" delete pod "${Q8_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q8_CLAIM}-app"'","namespace":"'"${Q8_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"},{"name":"logs","mountPath":"/logs"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q8_CLAIM}"'"}},{"name":"logs","hostPath":{"path":"/var/log/'"${Q8_CLAIM}"'-app","type":"DirectoryOrCreate"}}]}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=claim-elsewhere -->
#### The claim exists only in another namespace (`claim-elsewhere`)

Claim `${Q8_CLAIM}` was created in namespace `${Q8_NS}-shared`, not `${Q8_NS}`. A Pod can only use claims of its own namespace, so `${Q8_CLAIM}-app` stays `Pending` with "persistentvolumeclaim \"${Q8_CLAIM}\" not found". A claim cannot be moved: create `${Q8_CLAIM}` in `${Q8_NS}` (the volume behind the other claim stays there), then re-create the Pod.

```bash
kubectl -n "${Q8_NS}" delete pod "${Q8_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"PersistentVolumeClaim","metadata":{"name":"'"${Q8_CLAIM}"'","namespace":"'"${Q8_NS}"'"},"spec":{"storageClassName":"'"${Q8_CLAIM}"'-local","accessModes":["ReadWriteOnce"],"resources":{"requests":{"storage":"500Mi"}}}}'
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q8_CLAIM}-app"'","namespace":"'"${Q8_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q8_CLAIM}"'"}}]}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=pod-unschedulable -->
#### WaitForFirstConsumer claim waits for a Pod that cannot be scheduled (`pod-unschedulable`)

The claim looks like the problem: it stays `Pending` with "waiting for first consumer to be created before binding". But that is `WaitForFirstConsumer` working as designed: the volume is created on the node where its first Pod is scheduled, and the Pod is never scheduled, because its `nodeSelector: disktype=ssd` matches no node ("didn't match Pod's node affinity/selector" in `kubectl -n ${Q8_NS} describe pod ${Q8_CLAIM}-app`). Re-create the Pod without the nodeSelector; the claim then binds.

```bash
kubectl -n "${Q8_NS}" delete pod "${Q8_CLAIM}-app" --wait=true
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q8_CLAIM}-app"'","namespace":"'"${Q8_NS}"'"},"spec":{"containers":[{"name":"app","image":"busybox:1.36","command":["sleep","1d"],"volumeMounts":[{"name":"data","mountPath":"/data"}]}],"volumes":[{"name":"data","persistentVolumeClaim":{"claimName":"'"${Q8_CLAIM}"'"}}]}}'
```
<!-- /fault -->

### Question 9: StorageClass ${Q9_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: "${Q9_NAME}"
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: "${Q9_RECLAIM}"
volumeBindingMode: "${Q9_BINDING}"
allowVolumeExpansion: true
EOF
new=Immediate; [[ "${Q9_BINDING}" == Immediate ]] && new=WaitForFirstConsumer
kubectl get storageclass "${Q9_NAME}" -o yaml | sed "s/^volumeBindingMode: .*/volumeBindingMode: $new/" | kubectl replace --force -f -
```

### Question 10: Busiest Pods in ${Q10_NS}

```bash
kubectl top pod -n ${Q10_NS} --sort-by=memory --no-headers | head -1 | awk '{print $1}' > /opt/course/top/memory-pod.txt
kubectl top pod -n ${Q10_NS} --sort-by=cpu --no-headers | head -1 | awk '{print $1}' > /opt/course/top/cpu-pod.txt
```

### Question 11: Helm release ${Q11_REL}

```bash
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo add lab http://controlplane:8879
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo update lab
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q11_NS}" install "${Q11_REL}" lab/webapp --version "${Q11_VERSION}" --wait --timeout 3m
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q11_NS}" get manifest "${Q11_REL}" > "/opt/course/helm/${Q11_REL}-manifest.yaml"
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q11_NS}" upgrade "${Q11_REL}" lab/webapp --version 2.0.0 --reuse-values --wait --timeout 3m
```

### Question 12: Autoscaler ${Q12_APP} not working

**The healthy setup**

- the autoscaler targets Deployment `${Q12_APP}`, between `2` and `6` replicas, at `50%` average CPU utilization
- Deployment `${Q12_APP}` runs image `nginx:1.27-alpine`, container `web`, requesting `50m` CPU and `32Mi` memory
- metrics-server runs in `kube-system`, and APIService `v1beta1.metrics.k8s.io` is available

This run broke 2 things: **`${Q12_FAULT}`**, **`${Q12_FAULT_2}`**. Fix them in the order below.

**Problem 1: the autoscaler and its target**

<!-- fault Q12_FAULT=no-cpu-request -->
#### Deployment has no CPU request (`no-cpu-request`)

Utilization is measured against the container's CPU request, and `web` has none, so the autoscaler reports "missing request for cpu" (FailedGetResourceMetric) and its target stays `<unknown>`. Set the request back to `50m`: `kubectl -n ${Q12_NS} set resources deployment ${Q12_APP} -c web --requests=cpu=50m,memory=32Mi`.

```bash
kubectl -n "${Q12_NS}" set resources "deployment/${Q12_APP}" -c web --requests=cpu=50m,memory=32Mi
```
<!-- /fault -->

<!-- fault Q12_FAULT=target-name -->
#### Autoscaler targets a missing Deployment (`target-name`)

`scaleTargetRef.name` is `${Q12_APP}-v2`, which does not exist, so the autoscaler fails with FailedGetScale and never scales `${Q12_APP}`. Point it back at Deployment `${Q12_APP}`.

```bash
kubectl -n "${Q12_NS}" patch hpa "${Q12_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"name":"'"${Q12_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q12_FAULT=target-kind -->
#### Autoscaler targets the wrong kind (`target-kind`)

`scaleTargetRef.kind` is `StatefulSet`, and there is no StatefulSet `${Q12_APP}`, so the autoscaler fails with FailedGetScale. Set the kind back to `Deployment`.

```bash
kubectl -n "${Q12_NS}" patch hpa "${Q12_APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"kind":"Deployment"}}}'
```
<!-- /fault -->

<!-- fault Q12_FAULT=max-one -->
#### Replica range pinned to one (`max-one`)

The autoscaler's range is `1`-`1`, so it scaled `${Q12_APP}` down to a single replica and can never add more (ScalingLimited). Scaling the Deployment by hand does not help: the autoscaler overrides it. Restore `minReplicas: 2` and `maxReplicas: 6`.

```bash
kubectl -n "${Q12_NS}" patch hpa "${Q12_APP}" --type=merge -p '{"spec":{"minReplicas":2,"maxReplicas":6}}'
```
<!-- /fault -->

**Problem 2: the metrics pipeline**

<!-- fault Q12_FAULT_2=metrics-server-down -->
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

<!-- fault Q12_FAULT_2=metrics-apiservice -->
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

<!-- fault Q12_FAULT_2=metrics-kubelet-tls -->
#### metrics-server no longer accepts the kubelets' self-signed certificates (`metrics-kubelet-tls`)

metrics-server runs, but its new Pod never turns Ready: its logs say it cannot scrape any kubelet (`x509: cannot validate certificate for <node-ip> because it doesn't contain any IP SANs`). kubeadm kubelets serve self-signed certificates, which metrics-server only accepts with `--kubelet-insecure-tls`, and that flag was removed from its arguments. Without data, the `v1beta1.metrics.k8s.io` APIService is unavailable and `kubectl top` and every autoscaler fail. Add `--kubelet-insecure-tls` back to the container's `args` (`kubectl -n kube-system edit deploy metrics-server`).

```bash
kubectl -n kube-system patch deployment metrics-server --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```
<!-- /fault -->

### Question 13: Unhealthy worker

**The healthy setup**

- kubelet and containerd running and enabled on every worker, with `net.ipv4.ip_forward=1` persisted
- the kubelet's unit drop-in, `/var/lib/kubelet/config.yaml`, `/etc/kubernetes/kubelet.conf` and `/etc/default/kubelet` as kubeadm wrote them; no swap
- Calico's `10-calico.conflist` in `/etc/cni/net.d`, and a valid `/etc/containerd/config.toml`
- no worker cordoned or tainted

This run's fault: **`${Q13_FAULT}`** on `${Q13_NODE}`.

<!-- fault Q13_FAULT=kubelet-stopped -->
#### kubelet stopped and disabled (`kubelet-stopped`)

The kubelet was stopped and disabled, so the node stops sending heartbeats and turns `NotReady`. `systemctl status kubelet` shows it inactive. `systemctl enable --now kubelet` fixes it now and after a reboot.

On the broken worker:

```bash
systemctl enable --now kubelet
```
<!-- /fault -->

<!-- fault Q13_FAULT=containerd-stopped -->
#### containerd stopped and disabled (`containerd-stopped`)

The container runtime was stopped and disabled. The kubelet keeps running but reports `container runtime is down` / `NotReady`, and its log is full of CRI connection errors. `systemctl enable --now containerd` fixes it.

On the broken worker:

```bash
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q13_FAULT=ip-forward-and-containerd -->
#### IP forwarding off and containerd disabled (`ip-forward-and-containerd`)

`net.ipv4.ip_forward` is 0, `/etc/sysctl.d/k8s.conf` is missing, and `containerd` was stopped and disabled. The node turns `NotReady`. Put `net.ipv4.ip_forward=1` in `/etc/sysctl.d/k8s.conf`, apply with `sysctl --system`, and `systemctl enable --now containerd`.

On the broken worker:

```bash
printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/k8s.conf
sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q13_FAULT=kubelet-binary-path -->
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

<!-- fault Q13_FAULT=cordoned -->
#### Node cordoned (`cordoned`)

The node is `Ready` but cordoned (`SchedulingDisabled`), so no new Pods land on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q13_NODE}"
```
<!-- /fault -->

<!-- fault Q13_FAULT=stray-taint -->
#### Stray NoSchedule taint (`stray-taint`)

A `maintenance=true:NoSchedule` taint keeps every Pod without a matching toleration off the node, including the probe Pod. `kubectl describe node` lists it under Taints; remove it with `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q13_NODE}" maintenance-
```
<!-- /fault -->

<!-- fault Q13_FAULT=kubelet-config-invalid -->
#### kubelet config has the wrong kind (`kubelet-config-invalid`)

`/var/lib/kubelet/config.yaml` says `kind: KubeletConfig`. The kubelet cannot decode its own config and exits at start (no kind "KubeletConfig" is registered), so the node turns `NotReady`. `journalctl -u kubelet` shows the error. Set `kind: KubeletConfiguration` again and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's/^kind: KubeletConfig$/kind: KubeletConfiguration/' /var/lib/kubelet/config.yaml
grep -qE -- '^kind: KubeletConfiguration$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q13_FAULT=kubelet-api-port -->
#### kubelet kubeconfig uses the wrong API port (`kubelet-api-port`)

The kubelet runs, but `/etc/kubernetes/kubelet.conf` points it at port `6444` of the API server, so every request fails with "connection refused" and the node stops heartbeating. `journalctl -u kubelet` shows the URL; the API server listens on `6443` (compare `~/.kube/config`). Fix the port and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*server: https://.*):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
grep -qE -- 'server: https://.*:6443$' /etc/kubernetes/kubelet.conf || { echo "could not edit /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q13_FAULT=kubelet-extra-args -->
#### kubelet started with an unknown flag (`kubelet-extra-args`)

`/etc/default/kubelet` adds `--pod-max-pids-limit=100` to `KUBELET_EXTRA_ARGS`. No such flag exists (the real one is `--pod-max-pids`), so the kubelet exits with "unknown flag" right after start. `systemctl cat kubelet` shows the drop-in reads that file. Remove the flag and restart the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q13.kubelet-default" /etc/default/kubelet
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q13_FAULT=cni-config-removed -->
#### CNI configuration removed from the node (`cni-config-removed`)

The Calico network config (`10-calico.conflist`) is gone from `/etc/cni/net.d`. containerd reports the network as not ready, so the node turns `NotReady` with "container runtime network not ready ... cni plugin not initialized" (`kubectl describe node`, `journalctl -u kubelet`). `ls /etc/cni/net.d` is empty. Calico writes that file itself: delete the `calico-node` Pod on that worker (`kubectl -n kube-system delete pod -l k8s-app=calico-node --field-selector spec.nodeName=<node>`) and its `install-cni` init container writes it again. Copying it from the healthy worker also works if you change its `nodename`. Then restart containerd and the kubelet.

On the broken worker:

```bash
mv "/var/tmp/cka-q13.cni/"*.conflist /etc/cni/net.d/
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q13_FAULT=containerd-config-invalid -->
#### containerd config does not parse (`containerd-config-invalid`)

The last line of `/etc/containerd/config.toml` is an unclosed `[plugins` table, so containerd fails to start ("failed to load TOML"). The kubelet runs but cannot reach the runtime, and the node turns `NotReady`. `systemctl status containerd` and `journalctl -u containerd -n 20` point at the line. Remove it, then restart containerd and the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q13.containerd" /etc/containerd/config.toml
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q13_FAULT=kubelet-conf-missing -->
#### kubelet kubeconfig file is missing (`kubelet-conf-missing`)

`/etc/kubernetes/kubelet.conf` is gone, so the kubelet cannot authenticate to the API server and the node turns `NotReady`. `journalctl -u kubelet` mentions the missing kubeconfig. A worker's kubelet.conf only names the API server, the cluster CA and the path of the node's own client certificate (`/var/lib/kubelet/pki/kubelet-client-current.pem`), so the healthy worker's copy works unchanged: copy it across through controlplane, then restart the kubelet.

On the broken worker:

```bash
mv "/var/tmp/cka-q13.kubelet-conf" /etc/kubernetes/kubelet.conf
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q13_FAULT=kubelet-swap-on -->
#### Swap is enabled so the kubelet refuses to start (`kubelet-swap-on`)

A swap file (`/root/cka-swap`) is active and the kubelet runs with `failSwapOn: true`, so it exits rather than start with swap enabled. `swapon --show` lists the file; `journalctl -u kubelet` mentions swap. `swapoff` the file, remove it, and restart the kubelet.

On the broken worker:

```bash
swapoff /root/cka-swap 2>/dev/null || true
rm -f /root/cka-swap
sed -i '/^failSwapOn:/d' /var/lib/kubelet/config.yaml || true
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q13_FAULT=cni-conflist-typo -->
#### CNI conflist is present but invalid JSON (`cni-conflist-typo`)

A file still sits in `/etc/cni/net.d`, but it is not valid JSON (and names a bogus plugin): `python3 -m json.tool <file>` fails to parse it, and the runtime network never becomes ready, so the node turns `NotReady`. Calico writes that file itself: delete the broken file and the `calico-node` Pod on that worker, and its `install-cni` init container writes a good one. Then restart containerd and the kubelet.

On the broken worker:

```bash
f=$(ls /etc/cni/net.d/*.conflist 2>/dev/null | head -1)
[[ -f "/var/tmp/cka-q13.cni-conflist" ]] || { echo "missing CNI backup" >&2; exit 1; }
if [[ -n "$f" ]]; then cp -a "/var/tmp/cka-q13.cni-conflist" "$f"; else cp -a "/var/tmp/cka-q13.cni-conflist" /etc/cni/net.d/10-calico.conflist; fi
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

### Question 14: Deployment ${Q14_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: "${Q14_SA_SA}"
  namespace: "${Q14_NS}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: "${Q14_NAME}"
  namespace: "${Q14_NS}"
  labels:
    app: "${Q14_NAME}"
spec:
  replicas: ${Q14_REPLICAS}
  selector:
    matchLabels:
      app: "${Q14_NAME}"
  template:
    metadata:
      labels:
        app: "${Q14_NAME}"
    spec:
      containers:
        - name: app
          image: "${Q14_IMAGE}"
          ports:
            - containerPort: 80
      nodeSelector:
        disk: "${Q14_PLACE_DISK}"
      serviceAccountName: "${Q14_SA_SA}"
      automountServiceAccountToken: false
---
apiVersion: v1
kind: Service
metadata:
  name: "${Q14_NAME}"
  namespace: "${Q14_NS}"
spec:
  type: "${Q14_EXPOSE_TYPE}"
  selector:
    app: "${Q14_NAME}"
  ports:
    - port: ${Q14_EXPOSE_PORT}
      targetPort: 80
EOF
kubectl -n "${Q14_NS}" rollout status "deployment/${Q14_NAME}" --timeout=240s
kubectl -n "${Q14_NS}" set resources "deployment/${Q14_NAME}" --requests="cpu=${Q14_SETRES_CPU}" --limits="memory=${Q14_SETRES_MEMORY}"
kubectl -n "${Q14_NS}" rollout status "deployment/${Q14_NAME}" --timeout=240s
kubectl -n "${Q14_NS}" set image "deployment/${Q14_NAME}" "*=${Q14_UPDATE_IMAGE}"
kubectl -n "${Q14_NS}" rollout status "deployment/${Q14_NAME}" --timeout=240s
```

### Question 15: Pods of ${Q15_APP} keep restarting

**The healthy setup**

- `2` replicas of `nginx:1.27-alpine`, container `web` on port `80`, no command override
- requests `50m` CPU and `32Mi` memory; limits `250m` CPU and `128Mi` memory
- readiness and liveness probes doing an HTTP GET of `/` on port `80`, with timing that suits how fast nginx starts

This run's fault: **`${Q15_FAULT}`**.

<!-- fault Q15_FAULT=liveness-port -->
#### Liveness probe on a port nothing listens on (`liveness-port`)

The liveness probe calls port `8080`, where nothing listens, so every probe fails and the kubelet kills a healthy container about every 10 seconds. `describe pod` shows `Liveness probe failed: ... connection refused` and `Killing`. Point the probe at port `80`.

```bash
kubectl -n "${Q15_NS}" patch deployment "${Q15_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q15_FAULT=liveness-path -->
#### Liveness probe on a path that returns 404 (`liveness-path`)

The liveness probe requests `/healthz`, which nginx answers with 404, so the kubelet restarts the container again and again (`Liveness probe failed: HTTP probe failed with statuscode: 404`). The logs show the 404s too. Probe `/`.

```bash
kubectl -n "${Q15_NS}" patch deployment "${Q15_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q15_FAULT=liveness-exec -->
#### Exec liveness probe checks a file that never exists (`liveness-exec`)

The liveness probe runs `cat /tmp/healthy`, but nothing in the image ever creates that file, so the probe always fails and the container is killed every few seconds (`Liveness probe failed: cat: can't open '/tmp/healthy'`). Probe something the app really provides, such as an HTTP GET of `/` on port `80`.

```bash
kubectl -n "${Q15_NS}" patch deployment "${Q15_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe","value":{"httpGet":{"path":"/","port":80},"periodSeconds":5,"failureThreshold":2}}]'
```
<!-- /fault -->

<!-- fault Q15_FAULT=liveness-early -->
#### Liveness probe gives up before a slow start finishes (`liveness-early`)

The container waits 20 seconds before nginx starts (its command is part of the app and must stay), but the liveness probe starts after 2 seconds and gives up after two failures, so the kubelet kills the container before it ever serves. The logs are empty; `describe pod` shows `Liveness probe failed ... connection refused` and `Killing`. Give it time to start: a `startupProbe` (for example HTTP GET `/`, `periodSeconds: 5`, `failureThreshold: 12`) holds the liveness probe back until the app answers, or raise `initialDelaySeconds` above 20.

```bash
kubectl -n "${Q15_NS}" patch deployment "${Q15_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","startupProbe":{"httpGet":{"path":"/","port":80},"periodSeconds":5,"failureThreshold":12}}]}}}}'
```
<!-- /fault -->

<!-- fault Q15_FAULT=nginx-config-error -->
#### nginx configuration from a ConfigMap has a syntax error (`nginx-config-error`)

This time the app itself dies, not the kubelet: the container mounts ConfigMap `${Q15_APP}-nginx` at `/etc/nginx/conf.d`, and its `default.conf` misses the `;` after `listen 80`. nginx refuses the file and exits, so the Pods go into `CrashLoopBackOff` with no probe failures in the Events. `kubectl -n ${Q15_NS} logs <pod> --previous` shows the `[emerg]` line with the file and line number. Fix the ConfigMap (`kubectl -n ${Q15_NS} edit configmap ${Q15_APP}-nginx`) and restart the Deployment so the Pods read it at once.

```bash
printf '%s\n' 'server {' '    listen 80;' '    location / {' '        root /usr/share/nginx/html;' '        index index.html;' '    }' '}' > "/var/tmp/cka-q15.default.conf"
kubectl -n "${Q15_NS}" create configmap "${Q15_APP}-nginx" --from-file=default.conf="/var/tmp/cka-q15.default.conf" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${Q15_NS}" rollout restart "deployment/${Q15_APP}"
```
<!-- /fault -->

<!-- fault Q15_FAULT=oom-limit -->
#### Memory limit too low (OOMKilled) (`oom-limit`)

The memory limit is `4Mi`, less than nginx needs to start, so the kernel kills it: `describe pod` shows `Last State: Terminated, Reason: OOMKilled` (exit code 137) and the restart count climbs. Give the container a realistic limit, such as the `128Mi` it had (request `32Mi`).

```bash
kubectl -n "${Q15_NS}" set resources "deployment/${Q15_APP}" -c web --requests=memory=32Mi --limits=memory=128Mi
```
<!-- /fault -->

### Question 16: Frontend cannot reach ${Q16_APP}

**The healthy setup**

- `default-deny` selects every Pod for ingress and egress
- `allow-dns` lets every Pod reach the `kube-dns` Pods in `kube-system` on port `53`, UDP and TCP
- `frontend-egress` lets `role=frontend` Pods reach the `app=${Q16_APP}` Pods on TCP `80`
- `${Q16_APP}-ingress` selects the `app=${Q16_APP}` Pods and admits `role=frontend` Pods of the same namespace on TCP `80`

This run broke 2 things: **`${Q16_FAULT}`**, **`${Q16_FAULT_2}`**. Fix them in the order below.

**Problem 1: the frontend egress**

<!-- fault Q16_FAULT=egress-to-label -->
#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=${Q16_APP}-v2`, which do not exist, so the client's own egress is dropped even though `${Q16_APP}-ingress` would accept it. Select `app=${Q16_APP}`.

```bash
kubectl -n "${Q16_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"'"${Q16_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=egress-port -->
#### Frontend egress allowed on the wrong port (`egress-port`)

`frontend-egress` lets frontends connect to the `${Q16_APP}` Pods on port 8080 only, but nginx listens on 80, so the client's connection is dropped on its own side even though `${Q16_APP}-ingress` would accept it. Set the egress port to 80.

```bash
kubectl -n "${Q16_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=frontend-egress-deleted -->
#### Frontend egress NetworkPolicy was deleted (`frontend-egress-deleted`)

NetworkPolicy `frontend-egress` is missing, so `default-deny` drops the client's egress to `${Q16_APP}` even though DNS works and `${Q16_APP}-ingress` would accept the connection. Recreate `frontend-egress` so Pods labelled `role=frontend` can reach `app=${Q16_APP}` on TCP port 80.

```bash
kubectl -n "${Q16_NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"frontend-egress"},"spec":{"podSelector":{"matchLabels":{"role":"frontend"}},"policyTypes":["Egress"],"egress":[{"to":[{"podSelector":{"matchLabels":{"app":"'"${Q16_APP}"'"}}}],"ports":[{"protocol":"TCP","port":80}]}]}}'
```
<!-- /fault -->

<!-- fault Q16_FAULT=frontend-egress-selector -->
#### Frontend egress policy selects no Pod (`frontend-egress-selector`)

`frontend-egress` applies to Pods labelled `role=front-end`, but `client` is `role=frontend`. The allow rule protects nobody, and `default-deny` drops the client's egress. Set its podSelector to `role=frontend`.

```bash
kubectl -n "${Q16_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=netpol-egress-ipblock-except -->
#### Egress NetworkPolicy excepts the backend CIDR (`netpol-egress-ipblock-except`)

NetworkPolicy `frontend-egress-ipblock` allows egress to `0.0.0.0/0` on port 80 but `except`s `10.0.0.0/8` and `192.168.0.0/16`, which covers Pod and Service IPs, so the client still cannot reach `${Q16_APP}`. Delete that policy and restore `frontend-egress` (podSelector to `app=${Q16_APP}` on TCP/80).

```bash
kubectl -n "${Q16_NS}" delete networkpolicy frontend-egress-ipblock --ignore-not-found >/dev/null
kubectl -n "${Q16_NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"frontend-egress"},"spec":{"podSelector":{"matchLabels":{"role":"frontend"}},"policyTypes":["Egress"],"egress":[{"to":[{"podSelector":{"matchLabels":{"app":"'"${Q16_APP}"'"}}}],"ports":[{"protocol":"TCP","port":80}]}]}}'
```
<!-- /fault -->

**Problem 2: the API ingress**

<!-- fault Q16_FAULT_2=ingress-port -->
#### Ingress allowed on the wrong port (`ingress-port`)

`${Q16_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q16_NS}" patch networkpolicy "${Q16_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT_2=ingress-from-label -->
#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q16_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q16_NS}" patch networkpolicy "${Q16_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT_2=ingress-namespace-and -->
#### Ingress peer ANDs a namespace selector (`ingress-namespace-and`)

In `${Q16_APP}-ingress`, the `from` entry holds a `namespaceSelector` (`team=frontend`) and a `podSelector` in the **same** list item, so a peer must match both. No namespace is labelled `team=frontend`, so nothing is allowed in. `kubectl describe networkpolicy` shows it as one peer. Drop the namespaceSelector, so only Pods labelled `role=frontend` in `${Q16_NS}` are allowed.

```bash
kubectl -n "${Q16_NS}" patch networkpolicy "${Q16_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"podSelector":{"matchLabels":{"role":"frontend"}}}}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT_2=ingress-pod-selector -->
#### Ingress policy selects no Pod (`ingress-pod-selector`)

`${Q16_APP}-ingress` applies to Pods labelled `app=${Q16_APP}-v2`, which do not exist. Its allow rule protects nothing, and `default-deny` keeps dropping all ingress to the real `${Q16_APP}` Pods. Set its podSelector to `app=${Q16_APP}`.

```bash
kubectl -n "${Q16_NS}" patch networkpolicy "${Q16_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"'"${Q16_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT_2=ingress-port-443 -->
#### Ingress allowed on HTTPS only (`ingress-port-443`)

`${Q16_APP}-ingress` lets frontends in on port 443 only, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the ingress port back to 80.

```bash
kubectl -n "${Q16_NS}" patch networkpolicy "${Q16_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports","value":[{"protocol":"TCP","port":80}]}]'
```
<!-- /fault -->

### Question 17: ${Q17_APP} unreachable through the ingress

**The healthy setup**

- Service `${Q17_APP}`: port `80`, forwarding to the `${Q17_APP}` Pods
- Ingress `${Q17_APP}`: class `traefik`, host `www.${Q17_NS}.lab`, path `/` (`Prefix`) to Service `${Q17_APP}` on port `80`
- HTTPRoute `${Q17_APP}`: attached to the `web` listener of Gateway `traefik-gateway` in namespace `traefik`, host `api.${Q17_NS}.lab`, path `/` to Service `${Q17_APP}` on port `80`
- the controller: Deployment `traefik` in namespace `traefik`, its Service publishing the `web` port on NodePort `30080`, and IngressClass `traefik` naming controller `traefik.io/ingress-controller`

This run's fault: **`${Q17_FAULT}`**.

<!-- fault Q17_FAULT=ingress-service-name -->
#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `${Q17_APP}-svc`, which does not exist, so Traefik has nothing to send `www.${Q17_NS}.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `${Q17_APP}`.

```bash
kubectl -n "${Q17_NS}" patch ingress "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"'"${Q17_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=ingress-service-port -->
#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q17_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q17_NS}" patch ingress "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=ingress-class -->
#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.${Q17_NS}.lab`. Set the class back to `traefik`.

```bash
kubectl -n "${Q17_NS}" patch ingress "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=ingress-path -->
#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q17_NS}" patch ingress "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q17_NS}" patch httproute "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q17_NS}" patch httproute "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q17_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q17_NS}" patch httproute "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=ingress-host-typo -->
#### Ingress rule has a misspelled host (`ingress-host-typo`)

The Ingress rule's host is `ww.${Q17_NS}.lab`, not `www.${Q17_NS}.lab`. Traefik routes only matching Host headers, so `www.${Q17_NS}.lab` gets a 404. `kubectl -n ${Q17_NS} get ingress` shows the host: set it back to `www.${Q17_NS}.lab`.

```bash
kubectl -n "${Q17_NS}" patch ingress "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/host","value":"www.'"${Q17_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=route-parent-namespace -->
#### HTTPRoute looks for the Gateway in its own namespace (`route-parent-namespace`)

The HTTPRoute's `parentRefs` has no `namespace`, so it defaults to the route's own namespace `${Q17_NS}`, where there is no `traefik-gateway`. The route has no accepted parent. Add `namespace: traefik` to the parentRef.

```bash
kubectl -n "${Q17_NS}" patch httproute "${Q17_APP}" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=route-backend-name -->
#### HTTPRoute points at a Service that does not exist (`route-backend-name`)

The HTTPRoute's backendRef is Service `${Q17_APP}-svc`, which does not exist, so `ResolvedRefs` is `False` and `api.${Q17_NS}.lab` fails. Point the backendRef back at `${Q17_APP}`.

```bash
kubectl -n "${Q17_NS}" patch httproute "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/name","value":"'"${Q17_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=route-path-prefix -->
#### HTTPRoute path matches only /api (`route-path-prefix`)

The HTTPRoute only matches path prefix `/api`, so `/` gets Traefik's 404. Remove the `matches` block (or set the path to `/`) so every path on `api.${Q17_NS}.lab` is served.

```bash
kubectl -n "${Q17_NS}" patch httproute "${Q17_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/matches"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=ingress-path-prefix -->
#### Ingress path matches only /app (`ingress-path-prefix`)

The Ingress path is `/app` with `pathType: Prefix`, so `/` does not match and Traefik returns 404 for `www.${Q17_NS}.lab`. Set the path back to `/`.

```bash
kubectl -n "${Q17_NS}" patch ingress "${Q17_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=route-weight-zero -->
#### HTTPRoute backend weight is zero (`route-weight-zero`)

The HTTPRoute backendRef has `weight: 0`, so Traefik sends it no traffic and `api.${Q17_NS}.lab` fails even though the Service is healthy. Remove the weight (or set it above 0).

```bash
kubectl -n "${Q17_NS}" patch httproute "${Q17_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/backendRefs/0/weight"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=route-filter-redirect -->
#### HTTPRoute redirects instead of proxying (`route-filter-redirect`)

The HTTPRoute has a `RequestRedirect` filter, so requests for `api.${Q17_NS}.lab` get a 302 to `elsewhere.example` instead of the nginx welcome page. Remove the `filters` block so the route proxies to Service `${Q17_APP}`.

```bash
kubectl -n "${Q17_NS}" patch httproute "${Q17_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/filters"}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=controller-down -->
#### The Traefik controller is scaled to zero (`controller-down`)

Both hosts fail at once, and nothing in `${Q17_NS}` is wrong: Deployment `traefik` in namespace `traefik` has `0` replicas, so nothing listens behind NodePort `30080` (curl gets "connection refused"). Scale it back to `1`.

```bash
kubectl -n traefik scale deployment traefik --replicas=1
```
<!-- /fault -->

<!-- fault Q17_FAULT=controller-nodeport -->
#### The controller's Service moved to another NodePort (`controller-nodeport`)

Traefik runs and every object in `${Q17_NS}` is right, but the `web` port of Service `traefik/traefik` now uses NodePort `30081`, so nothing answers on `30080` (`kubectl -n traefik get svc traefik` shows `80:30081/TCP`). The task's URL uses `30080`: set the `web` port's `nodePort` back to `30080`.

```bash
i=$(kubectl -n traefik get service traefik -o jsonpath='{range .spec.ports[*]}{.name}{"\n"}{end}' | grep -n '^web$' | cut -d: -f1)
kubectl -n traefik patch service traefik --type=json -p '[{"op":"replace","path":"/spec/ports/'"$((i - 1))"'/nodePort","value":30080}]'
```
<!-- /fault -->

<!-- fault Q17_FAULT=ingressclass-controller -->
#### IngressClass traefik names another controller (`ingressclass-controller`)

IngressClass `traefik` now names controller `k8s.io/ingress-nginx`, which does not run here. Traefik only serves Ingresses whose class names `traefik.io/ingress-controller`, so `www.${Q17_NS}.lab` fails while `api.${Q17_NS}.lab` (Gateway API, which uses the GatewayClass) still works. `kubectl get ingressclass traefik -o yaml` shows the controller; the field cannot be edited, so delete the IngressClass and create it again with `controller: traefik.io/ingress-controller`.

```bash
kubectl delete ingressclass traefik --wait=true
kubectl create -f /var/tmp/cka-ingressclass-traefik.json
```
<!-- /fault -->
