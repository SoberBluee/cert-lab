## Solution

### Question 1: Deployment ${Q1_APP} does not serve its page

This run's fault: **`${Q1_FAULT}`**.

Every fault this question can roll:

#### Volume names a ConfigMap that does not exist (`configmap-volume-missing`)

The `content` volume refers to ConfigMap `${Q1_APP}-contents`, which does not exist, so the Pods stay in `ContainerCreating` and the Events show `FailedMount ... configmap "${Q1_APP}-contents" not found`. Point the volume back at `${Q1_APP}-content`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"'"${Q1_APP}"'-content"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### Secret volume asks for a key the Secret does not have (`secret-items-key`)

The `secret` volume projects key `api-token`, but Secret `${Q1_APP}-secret` only has `token`. The mount fails (`references non-existent secret key: api-token` in the Events) and the Pods stay in `ContainerCreating`. Set the item key back to `token`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/1/secret/items/0/key","value":"token"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### ConfigMap mounted one directory too high (`mount-path`)

The ConfigMap is mounted at `/usr/share/nginx`, which hides the `html` directory nginx serves from. nginx runs, but `/` returns 404, so the readiness probe fails and the Pods stay `0/1`. `kubectl exec` and `ls /usr/share/nginx` show `index.html` in the wrong place. Mount it at `/usr/share/nginx/html`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/volumeMounts/0/mountPath","value":"/usr/share/nginx/html"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### runAsNonRoot on an image that runs as root (`run-as-non-root`)

The container sets `runAsNonRoot: true`, but the nginx image starts as root, so the kubelet refuses to start it: `CreateContainerConfigError` with `container has runAsNonRoot and image will run as root`. Remove the securityContext (or run an image built for a non-root user).

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

#### Read-only root filesystem (`readonly-root`)

The container sets `readOnlyRootFilesystem: true`. nginx needs to write its cache and pid files, so it exits at startup and the Pods go into `CrashLoopBackOff`; `kubectl logs --previous` shows `Read-only file system`. Remove the securityContext, or mount writable `emptyDir` volumes where nginx writes.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```

### Question 2: ${Q2_APP} cannot list Pods

This run's fault: **`${Q2_FAULT}`**.

Every fault this question can roll:

#### Role grants get but not list (`role-verb`)

Role `${Q2_APP}-reader` only allows `get`. Listing Pods is the `list` verb, so the API answers 403 Forbidden. Add `list` to the verbs.

```bash
kubectl -n "${Q2_NS}" patch role "${Q2_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/verbs","value":["get","list"]}]'
```

#### Role names the resource "pod" (`role-resource`)

Role `${Q2_APP}-reader` grants access to `pod`. RBAC resources are the plural API names, so `pod` matches nothing and the call gets 403. Use `pods`.

```bash
kubectl -n "${Q2_NS}" patch role "${Q2_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/resources","value":["pods"]}]'
```

#### RoleBinding subject in the wrong namespace (`binding-subject-ns`)

RoleBinding `${Q2_APP}-reader` grants the Role to ServiceAccount `${Q2_APP}-sa` in namespace `default`, a different account from the one the Pod uses. Set the subject's namespace to `${Q2_NS}`.

```bash
kubectl -n "${Q2_NS}" patch rolebinding "${Q2_APP}-reader" --type=json -p '[{"op":"replace","path":"/subjects/0/namespace","value":"'"${Q2_NS}"'"}]'
```

#### RoleBinding refers to a Role that does not exist (`binding-role-ref`)

RoleBinding `${Q2_APP}-reader` refers to Role `${Q2_APP}-viewer`, which does not exist, so it grants nothing. `roleRef` cannot be edited: delete the RoleBinding and create it again for Role `${Q2_APP}-reader`.

```bash
kubectl -n "${Q2_NS}" delete rolebinding "${Q2_APP}-reader"
kubectl -n "${Q2_NS}" create rolebinding "${Q2_APP}-reader" --role="${Q2_APP}-reader" --serviceaccount="${Q2_NS}:${Q2_APP}-sa"
```

#### Deployment runs as the default ServiceAccount (`wrong-sa`)

The Deployment runs as ServiceAccount `default`, which has no Role, so the call gets 403 for `system:serviceaccount:${Q2_NS}:default` (the logs and `kubectl get pod -o yaml` show the account). Set `serviceAccountName: ${Q2_APP}-sa`.

```bash
kubectl -n "${Q2_NS}" set serviceaccount "deployment/${Q2_APP}" "${Q2_APP}-sa"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```

#### ServiceAccount token not mounted (`automount-off`)

ServiceAccount `${Q2_APP}-sa` sets `automountServiceAccountToken: false`, so no token is mounted and the Pod logs `no token`. RBAC is fine. Allow the automount (on the ServiceAccount or the Pod spec) and restart the Deployment so new Pods get the token.

```bash
kubectl -n "${Q2_NS}" patch serviceaccount "${Q2_APP}-sa" -p '{"automountServiceAccountToken":true}'
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=240s
```

### Question 3: CronJob ${Q3_APP} never succeeds

This run's fault: **`${Q3_FAULT}`**.

Every fault this question can roll:

#### CronJob suspended (`suspended`)

The CronJob has `suspend: true`, so it never creates a Job: `kubectl get cronjob` shows `SUSPEND True` and no `LAST SCHEDULE`. Set `suspend: false`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=merge -p '{"spec":{"suspend":false}}'
```

#### Schedule that never fires (`never-schedule`)

The schedule is `0 0 31 2 *`: midnight on February 31st, a date that never comes. It is valid cron syntax, so the API accepts it, but no Job is ever created. Set it back to `* * * * *`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=merge -p '{"spec":{"schedule":"* * * * *"}}'
```

#### Job time limit shorter than the work (`deadline`)

Each Job has `activeDeadlineSeconds: 3`, but the command sleeps 8 seconds, so every Job is killed and marked failed with reason `DeadlineExceeded` (`kubectl describe job`). Remove the deadline.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/activeDeadlineSeconds"}]'
```

#### Job command fails and is never retried (`backoff-zero-command`)

The command runs `ech` instead of `echo`, so the container exits with code 127 (`kubectl logs` shows `sh: ech: not found`), and `backoffLimit: 0` fails the Job on the first error. Fix the command and set `backoffLimit` back to `2`.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/backoffLimit","value":2},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/command/2","value":"date; sleep 8; echo report done"}]'
```

#### Image from a registry that does not exist (`image-registry`)

The image is `registry.invalid/busybox:1.36`, a registry host that does not resolve. The Jobs are created, but their Pods sit in `ErrImagePull` / `ImagePullBackOff` and never finish. Set the image back to `busybox:1.36`; the stuck Jobs can be deleted.

```bash
kubectl -n "${Q3_NS}" patch cronjob "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/image","value":"busybox:1.36"}]'
```

### Question 4: Frontend cannot reach ${Q4_APP}

This run's fault: **`${Q4_FAULT}`**.

Every fault this question can roll:

#### DNS egress allowed on the wrong port (`dns-egress-port`)

`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
```

#### DNS egress selects a namespace label that does not exist (`dns-namespace-selector`)

`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "allow-dns" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]'
```

#### Ingress allowed on the wrong port (`ingress-port`)

`${Q4_APP}-ingress` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "${Q4_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'
```

#### Ingress allows a label no Pod carries (`ingress-from-label`)

`${Q4_APP}-ingress` allows Pods labelled `role=front-end`, but the client is `role=frontend` (`kubectl get pods --show-labels`). Fix the label in the policy.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "${Q4_APP}-ingress" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'
```

#### Frontend egress points at the wrong Pods (`egress-to-label`)

`frontend-egress` only lets frontends connect to Pods labelled `app=${Q4_APP}-v2`, which do not exist, so the client's own egress is dropped even though `${Q4_APP}-ingress` would accept it. Select `app=${Q4_APP}`.

```bash
kubectl -n "${Q4_NS}" patch networkpolicy "frontend-egress" --type=json -p '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"'"${Q4_APP}"'"}}]'
```

### Question 5: Worker after a configuration change

This run's fault: **`${Q5_FAULT}`** on `${Q5_NODE}`.

Every fault this question can roll:

#### kubelet kubeconfig points at the wrong API server port (`kubelet-kubeconfig-server`)

`server:` in `/etc/kubernetes/kubelet.conf` on the worker uses port `6444`, where nothing listens. The kubelet keeps running but cannot post its status, so the node turns `NotReady`; `journalctl -u kubelet` is full of `connection refused` for `:6444`. Set the port back to `6443` and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
grep -qE -- 'server: https://[^[:space:]]+:6443$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet
```

#### kubelet client CA file path is wrong (`kubelet-client-ca`)

`authentication.x509.clientCAFile` in `/var/lib/kubelet/config.yaml` points at `/etc/kubernetes/pki/ca.pem`, which does not exist, so the kubelet exits at startup (`unable to load client CA file`) and systemd keeps restarting it. `ls /etc/kubernetes/pki` shows `ca.crt`. Fix the path and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*clientCAFile: /etc/kubernetes/pki/)ca\.pem$#\1ca.crt#' /var/lib/kubelet/config.yaml
grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca.crt$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```

#### kubelet points at the wrong container runtime socket (`runtime-endpoint`)

`containerRuntimeEndpoint` in `/var/lib/kubelet/config.yaml` points at the CRI-O socket `/var/run/crio/crio.sock`, but the node runs containerd. containerd itself is healthy, yet the kubelet cannot reach a runtime and fails to start. `journalctl -u kubelet` names the missing socket; `/etc/crictl.yaml` or `ls /var/run/containerd` shows the right one. Fix the endpoint and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^containerRuntimeEndpoint: unix:///var/run/crio/crio\.sock$#containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock#' /var/lib/kubelet/config.yaml
grep -qE -- '^containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```

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

### Question 6: kubectl stopped working

This run's fault: **`${Q6_FAULT}`**.

Every fault this question can roll:

#### User kubeconfigs point at the wrong port (`kubeconfig-server-port`)

`server:` in `/root/.kube/config` and `/home/ubuntu/.kube/config` uses port `6433` instead of `6443`, so kubectl gets `connection refused` even though the API server is healthy (`curl -k https://127.0.0.1:6443/readyz` answers `ok`). Fix the port in both files, or copy `/etc/kubernetes/admin.conf` over them.

```bash
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /root/.kube/config
grep -qE -- 'server: https://[^[:space:]]+:6443$' /root/.kube/config || { echo "could not modify /root/.kube/config" >&2; exit 1; }
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /home/ubuntu/.kube/config
grep -qE -- 'server: https://[^[:space:]]+:6443$' /home/ubuntu/.kube/config || { echo "could not modify /home/ubuntu/.kube/config" >&2; exit 1; }
```

#### User kubeconfigs trust the wrong CA (`kubeconfig-wrong-ca`)

`certificate-authority-data` in both user kubeconfigs holds the front-proxy CA (`/etc/kubernetes/pki/front-proxy-ca.crt`) instead of the cluster CA, so kubectl rejects the API server's certificate: `x509: certificate signed by unknown authority`. Put `/etc/kubernetes/pki/ca.crt` back (`kubectl config set clusters.kubernetes.certificate-authority-data $(base64 -w0 /etc/kubernetes/pki/ca.crt)`), or copy `/etc/kubernetes/admin.conf` over them.

```bash
for f in /root/.kube/config /home/ubuntu/.kube/config; do
  kubectl config --kubeconfig "$f" set clusters.kubernetes.certificate-authority-data "$(base64 -w0 /etc/kubernetes/pki/ca.crt)" >/dev/null
done
```

#### API server client CA file path is wrong (`apiserver-client-ca`)

`--client-ca-file` in `/etc/kubernetes/manifests/kube-apiserver.yaml` points at `/etc/kubernetes/pki/ca.cert`, which does not exist, so the API server exits at startup and kubectl gets `connection refused`. `crictl logs` of the last kube-apiserver container shows the missing file; `ls /etc/kubernetes/pki` shows `ca.crt`.

```bash
sed -i -E 's#^([[:space:]]*- --client-ca-file=/etc/kubernetes/pki/ca)\.cert$#\1.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --client-ca-file=/etc/kubernetes/pki/ca.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```

#### API server listens on the wrong port (`apiserver-secure-port`)

`--secure-port` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `6444`, so nothing answers on `6443`: kubectl, the kubelets and the other components get `connection refused`, and the API server's own probes (which target the `probe-port`, 6443) fail until the kubelet restarts it. `ss -ltnp` shows it listening on 6444. Set the port back to `6443`.

```bash
sed -i -E 's#^([[:space:]]*- --secure-port=)6444$#\16443#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --secure-port=6443$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```

#### API server manifest is not valid YAML (`apiserver-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-apiserver.yaml` is indented by three spaces instead of four, which makes the file invalid YAML. The kubelet cannot parse the manifest, so it drops the kube-apiserver static pod: no container at all in `crictl ps -a`, and `journalctl -u kubelet` reports the manifest it could not decode. Fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-apiserver:)#    image: \1#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '^    image: registry.k8s.io/kube-apiserver:' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
