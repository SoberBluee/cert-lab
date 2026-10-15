## Solution

### Question 1: kubeconfig

<!-- fault Q1_KIND=contexts-cert -->
```bash
kubectl config get-contexts -o name > /opt/course/q1/contexts
cat > /opt/course/q1/current-context.sh <<'EOF'
#!/usr/bin/env bash
awk '/^current-context:/ {print $2}' ~/.kube/config
EOF
kubectl config view --raw -o jsonpath='{.users[?(@.name=="${Q1_USER}")].user.client-certificate-data}' | base64 -d > /opt/course/q1/${Q1_USER}.crt
openssl x509 -in /opt/course/q1/${Q1_USER}.crt -noout -subject   # CN = ${Q1_USER}
```

`kubectl config view` hides certificate data unless you pass `--raw`.
<!-- /fault -->
<!-- fault Q1_KIND=cluster-servers -->
A context only references a cluster by name; the URL lives in the `clusters` list. `kubectl config get-contexts` shows which cluster each context uses:

```bash
kubectl config get-contexts
kubectl config view -o jsonpath='{range .clusters[*]}{.name} {.cluster.server}{"\n"}{end}'
# kubernetes  https://controlplane:6443
# staging     https://192.0.2.10:6443
# legacy      https://10.20.0.5:8443
```

Combine the two, one line per context (`infra-stage`, `legacy-admin` and `staging-${Q1_USER}` do **not** use cluster `kubernetes`):

```bash
for c in $(kubectl config get-contexts -o name); do
  cl=$(kubectl config view -o jsonpath="{.contexts[?(@.name==\"$c\")].context.cluster}")
  echo "$c $(kubectl config view -o jsonpath="{.clusters[?(@.name==\"$cl\")].cluster.server}")"
done > /opt/course/q1/servers

kubectl config view --raw -o jsonpath='{.clusters[?(@.name=="kubernetes")].cluster.certificate-authority-data}' | base64 -d > /opt/course/q1/ca.crt
openssl x509 -in /opt/course/q1/ca.crt -noout -enddate > /opt/course/q1/ca-expiry
```
<!-- /fault -->
<!-- fault Q1_KIND=new-context -->
```bash
kubectl create namespace team-${Q1_USER}
kubectl -n team-${Q1_USER} create rolebinding ${Q1_USER}-edit --clusterrole=edit --user=${Q1_USER}
kubectl config set-context ${Q1_USER}-team --cluster=kubernetes --user=${Q1_USER} --namespace=team-${Q1_USER}
kubectl --context ${Q1_USER}-team get pods          # No resources found in team-${Q1_USER} namespace.
kubectl config current-context                       # still kubernetes-admin@kubernetes
```

`set-context` only writes the entry; `use-context` would switch to it. Binding ClusterRole `edit` with a **RoleBinding** limits it to that one namespace. The user name RBAC sees is the certificate's CN (`${Q1_USER}`).
<!-- /fault -->

### Question 2: least-privilege ServiceAccount

<!-- fault Q2_KIND=deployer -->
```bash
kubectl -n ${Q2_NS} create sa ${Q2_SA}
kubectl -n ${Q2_NS} create role ${Q2_SA}-role --verb=get,list,watch,create,update,patch --resource=deployments.apps
kubectl -n ${Q2_NS} edit role ${Q2_SA}-role        # add a rule: apiGroups [""], resources [pods], verbs [get, list]
kubectl -n ${Q2_NS} create rolebinding ${Q2_SA}-role --role=${Q2_SA}-role --serviceaccount=${Q2_NS}:${Q2_SA}
kubectl create clusterrole ${Q2_SA}-nodes --verb=get,list --resource=nodes
kubectl create clusterrolebinding ${Q2_SA}-nodes --clusterrole=${Q2_SA}-nodes --serviceaccount=${Q2_NS}:${Q2_SA}
kubectl -n ${Q2_NS} create deployment ${Q2_SA}-probe --image=nginx:1.27-alpine $do > probe.yaml   # add serviceAccountName: ${Q2_SA}
kubectl auth can-i delete deployments -n ${Q2_NS} --as=system:serviceaccount:${Q2_NS}:${Q2_SA}   # no
```

A single `kubectl create role` with `--resource=deployments.apps,pods` would give the same verbs on both resources, so Pods would get too much. Use two rules.
<!-- /fault -->
<!-- fault Q2_KIND=configmap-editor -->
```bash
kubectl -n ${Q2_NS} create sa ${Q2_SA}
kubectl create clusterrole ${Q2_SA}-config --verb=get,list,watch,create,update,patch,delete --resource=configmaps
kubectl -n ${Q2_NS} create rolebinding ${Q2_SA}-config --clusterrole=${Q2_SA}-config --serviceaccount=${Q2_NS}:${Q2_SA}
kubectl -n ${Q2_NS} create deployment ${Q2_SA}-probe --image=nginx:1.27-alpine $do > probe.yaml   # add serviceAccountName: ${Q2_SA}
kubectl auth can-i create configmaps -n default --as=system:serviceaccount:${Q2_NS}:${Q2_SA}   # no
```

A ClusterRole is just a reusable set of rules. Where it applies depends on the binding: a RoleBinding grants it in its own namespace, a ClusterRoleBinding everywhere.
<!-- /fault -->
<!-- fault Q2_KIND=job-runner -->
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: ${Q2_SA}-role, namespace: ${Q2_NS} }
rules:
  - { apiGroups: [batch], resources: [jobs], verbs: [get, list, watch, create, delete] }
  - { apiGroups: [""], resources: [pods], verbs: [get, list, watch] }
  - { apiGroups: [""], resources: [pods/log], verbs: [get] }
```

```bash
kubectl -n ${Q2_NS} create sa ${Q2_SA}
kubectl -n ${Q2_NS} create rolebinding ${Q2_SA}-role --role=${Q2_SA}-role --serviceaccount=${Q2_NS}:${Q2_SA}
kubectl create clusterrole ${Q2_SA}-nodes --verb=get,list --resource=nodes
kubectl create clusterrolebinding ${Q2_SA}-nodes --clusterrole=${Q2_SA}-nodes --serviceaccount=${Q2_NS}:${Q2_SA}
kubectl -n ${Q2_NS} create job ${Q2_SA}-probe --image=busybox:1.36 $do -- echo ok > job.yaml   # add serviceAccountName: ${Q2_SA}
kubectl auth can-i get pods --subresource=log -n ${Q2_NS} --as=system:serviceaccount:${Q2_NS}:${Q2_SA}    # yes
kubectl auth can-i create pods --subresource=exec -n ${Q2_NS} --as=system:serviceaccount:${Q2_NS}:${Q2_SA} # no
```

Logs and exec are subresources (`pods/log`, `pods/exec`); a rule on `pods` grants neither. Jobs live in API group `batch`.
<!-- /fault -->

### Question 3: etcd

Every `etcdctl` call against the live member needs the endpoint and the certificates from `/etc/kubernetes/manifests/etcd.yaml`:

```bash
export ETCDCTL_API=3
alias e='sudo etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key'
```

<!-- fault Q3_KIND=snapshot -->
```bash
e snapshot save /opt/course/q3/etcd-snapshot.db
sudo etcdctl snapshot status /opt/course/q3/etcd-snapshot.db -w table | sudo tee /opt/course/q3/snapshot-status.txt
```
<!-- /fault -->
<!-- fault Q3_KIND=restore -->
```bash
e snapshot save /opt/course/q3/etcd-snapshot.db
sudo etcdutl snapshot restore /opt/course/q3/etcd-snapshot.db --data-dir /var/lib/etcd-restore-test
ls /var/lib/etcd-restore-test/member     # snap  wal
```

`snapshot restore` only reads the file and writes a new data directory; it needs no endpoint or certificates, and the target directory must not exist yet. A real restore would then point the `etcd-data` hostPath in `etcd.yaml` at the new directory. Here that is exactly what you must **not** do.
<!-- /fault -->
<!-- fault Q3_KIND=member-health -->
```bash
e member list -w table | sudo tee /opt/course/q3/members.txt
e endpoint health 2>&1 | sudo tee /opt/course/q3/health.txt       # https://127.0.0.1:2379 is healthy: ...
e endpoint status -w table | sudo tee /opt/course/q3/version.txt   # VERSION column = server version
```

`etcdctl version` prints the version of the **client** binary only. The server version comes from `endpoint status` (or from the image tag in `etcd.yaml`).
<!-- /fault -->

### Question 4: certificates

<!-- fault Q4_KIND=apiserver-kubelet -->
```bash
sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate > /opt/course/q4/apiserver-expiry
echo "kubeadm certs renew apiserver" > /opt/course/q4/renew.sh
ssh ${Q4_NODE}
sudo openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -issuer -ext extendedKeyUsage
#   issuer CN = kubernetes,            TLS Web Client Authentication
sudo openssl x509 -in /var/lib/kubelet/pki/kubelet.crt -noout -issuer -ext extendedKeyUsage
#   issuer CN = ${Q4_NODE}-ca@<timestamp>, TLS Web Server Authentication (self-signed)
```
<!-- /fault -->
<!-- fault Q4_KIND=etcd-server -->
```bash
grep cert-file /etc/kubernetes/manifests/etcd.yaml      # --cert-file=/etc/kubernetes/pki/etcd/server.crt
sudo openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -ext subjectAltName | tail -n +2 > /opt/course/q4/etcd-sans
#   DNS:controlplane, DNS:localhost, IP Address:<node IP>, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1
sudo openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -enddate > /opt/course/q4/etcd-expiry
echo "kubeadm certs renew etcd-server" > /opt/course/q4/renew.sh
```

etcd has three certificates of its own: `etcd-server` (clients), `etcd-peer` (other members) and `etcd-healthcheck-client`. `kubeadm certs renew --help` lists them all.
<!-- /fault -->
<!-- fault Q4_KIND=front-proxy -->
```bash
grep front-proxy /etc/kubernetes/manifests/kube-apiserver.yaml
#   --proxy-client-cert-file=/etc/kubernetes/pki/front-proxy-client.crt
#   --proxy-client-key-file=/etc/kubernetes/pki/front-proxy-client.key
#   --requestheader-client-ca-file=/etc/kubernetes/pki/front-proxy-ca.crt
grep -oE -- '--(requestheader-client-ca-file|proxy-client-cert-file)=[^ ]+' /etc/kubernetes/manifests/kube-apiserver.yaml > /opt/course/q4/front-proxy-flags
sudo openssl x509 -in /etc/kubernetes/pki/front-proxy-client.crt -noout -issuer > /opt/course/q4/front-proxy-issuer   # CN = front-proxy-ca
echo "kubeadm certs renew front-proxy-client" > /opt/course/q4/renew.sh
```

The front-proxy chain has its own CA (`front-proxy-ca`), separate from the cluster CA. The API server presents `front-proxy-client` to aggregated API servers, and they trust it through `--requestheader-client-ca-file`.
<!-- /fault -->

### Question 5: node maintenance

<!-- fault Q5_KIND=drain-dedicate -->
```bash
kubectl drain ${Q5_NODE} --ignore-daemonsets --force
# --force deletes the unmanaged Pod "scratch"; evictions respect the PDB, so the drain waits for replacements
kubectl taint node ${Q5_NODE} dedicated=${Q5_TAINT}:NoSchedule
kubectl uncordon ${Q5_NODE}
```

```yaml
apiVersion: v1
kind: Pod
metadata: { name: ${Q5_POD}, namespace: ${Q5_NS} }
spec:
  nodeSelector: { kubernetes.io/hostname: ${Q5_NODE} }
  tolerations: [{ key: dedicated, operator: Equal, value: ${Q5_TAINT}, effect: NoSchedule }]
  containers: [{ name: ${Q5_POD}, image: nginx:1.27-alpine }]
```
<!-- /fault -->
<!-- fault Q5_KIND=noexecute-evict -->
```bash
kubectl taint node ${Q5_NODE} dedicated=${Q5_TAINT}:NoExecute
kubectl -n ${Q5_NS} get pods -o wide -w          # ${Q5_APP} Pods on ${Q5_NODE} and scratch are evicted at once
```

`NoExecute` evicts every running Pod that does not tolerate the taint, unmanaged ones included. Unlike `kubectl drain`, the taint manager does not use the eviction API, so the PDB is **not** consulted. DaemonSet Pods stay, because they tolerate everything.

```yaml
apiVersion: v1
kind: Pod
metadata: { name: ${Q5_POD}, namespace: ${Q5_NS} }
spec:
  nodeSelector: { kubernetes.io/hostname: ${Q5_NODE} }
  tolerations:
    - { key: dedicated, operator: Equal, value: ${Q5_TAINT}, effect: NoExecute, tolerationSeconds: 3600 }
  containers: [{ name: ${Q5_POD}, image: nginx:1.27-alpine }]
```

`tolerationSeconds` only exists for `NoExecute`: the Pod may stay for that long after the taint appears, then it is evicted too.
<!-- /fault -->
<!-- fault Q5_KIND=cordon-move -->
```bash
kubectl cordon ${Q5_NODE}
kubectl label node ${Q5_NODE} maintenance=true
kubectl -n ${Q5_NS} edit deployment ${Q5_APP}
```

```yaml
spec:
  template:
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - { key: maintenance, operator: NotIn, values: ["true"] }
```

```bash
kubectl -n ${Q5_NS} rollout status deployment ${Q5_APP}
kubectl -n ${Q5_NS} get pods -o wide            # all ${Q5_APP} Pods elsewhere, scratch still on ${Q5_NODE}
```

`cordon` moves nothing; it only stops new Pods from landing. Changing the Pod template starts a rollout, and the new Pods must avoid the labelled node. A rolling update is not an eviction, so the PDB does not block it. `drain` would have deleted `scratch`.
<!-- /fault -->
