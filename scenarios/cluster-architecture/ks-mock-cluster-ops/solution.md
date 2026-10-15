## Solution

### Question 1: kubeconfig forensics

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

### Question 2: least-privilege ServiceAccount

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

### Question 3: etcd snapshot

```bash
sudo ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /opt/course/q3/etcd-snapshot.db
sudo ETCDCTL_API=3 etcdctl snapshot status /opt/course/q3/etcd-snapshot.db -w table | sudo tee /opt/course/q3/snapshot-status.txt
```

### Question 4: certificates

```bash
sudo openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate > /opt/course/q4/apiserver-expiry
echo "kubeadm certs renew apiserver" > /opt/course/q4/renew.sh
ssh ${Q4_NODE}
sudo openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -issuer -ext extendedKeyUsage
#   issuer CN = kubernetes,            TLS Web Client Authentication
sudo openssl x509 -in /var/lib/kubelet/pki/kubelet.crt -noout -issuer -ext extendedKeyUsage
#   issuer CN = ${Q4_NODE}-ca@<timestamp>, TLS Web Server Authentication (self-signed)
```

### Question 5: drain and dedicate

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
