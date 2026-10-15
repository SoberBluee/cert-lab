#!/usr/bin/env bash
# Applied by "cka verify" on controlplane. Runs as root.
set -euo pipefail

# Question 1
cfg=/home/ubuntu/.kube/config
kubectl --kubeconfig "$cfg" config get-contexts -o name > /opt/course/q1/contexts
cat > /opt/course/q1/current-context.sh <<'EOF'
#!/usr/bin/env bash
awk '/^current-context:/ {print $2}' ~/.kube/config | tr -d '"'
EOF
chmod +x /opt/course/q1/current-context.sh
kubectl --kubeconfig "$cfg" config view --raw -o jsonpath="{.users[?(@.name==\"${Q1_USER}\")].user.client-certificate-data}" | base64 -d > "/opt/course/q1/${Q1_USER}.crt"

# Question 2
kubectl -n "$Q2_NS" create serviceaccount "$Q2_SA"
kubectl -n "$Q2_NS" create role "${Q2_SA}-role" --verb=get,list,watch,create,update,patch --resource=deployments.apps
kubectl -n "$Q2_NS" patch role "${Q2_SA}-role" --type=json -p '[{"op":"add","path":"/rules/-","value":{"apiGroups":[""],"resources":["pods"],"verbs":["get","list"]}}]'
kubectl -n "$Q2_NS" create rolebinding "${Q2_SA}-role" --role="${Q2_SA}-role" --serviceaccount="${Q2_NS}:${Q2_SA}"
kubectl create clusterrole "${Q2_SA}-nodes" --verb=get,list --resource=nodes
kubectl create clusterrolebinding "${Q2_SA}-nodes" --clusterrole="${Q2_SA}-nodes" --serviceaccount="${Q2_NS}:${Q2_SA}"
kubectl -n "$Q2_NS" create deployment "${Q2_SA}-probe" --image=nginx:1.27-alpine --dry-run=client -o json \
  | jq --arg sa "$Q2_SA" '.spec.template.spec.serviceAccountName = $sa' | kubectl apply -f -

# Question 3
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /opt/course/q3/etcd-snapshot.db
ETCDCTL_API=3 etcdctl snapshot status /opt/course/q3/etcd-snapshot.db -w table > /opt/course/q3/snapshot-status.txt

# Question 4
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate > /opt/course/q4/apiserver-expiry
echo "kubeadm certs renew apiserver" > /opt/course/q4/renew.sh
remote() { sudo -u ubuntu ssh -o StrictHostKeyChecking=accept-new "$Q4_NODE" "sudo $1"; }
{
  echo "client issuer: $(remote 'openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -issuer')"
  echo "client usage: $(remote 'openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -ext extendedKeyUsage' | tail -1 | xargs)"
  echo "server issuer: $(remote 'openssl x509 -in /var/lib/kubelet/pki/kubelet.crt -noout -issuer')"
  echo "server usage: $(remote 'openssl x509 -in /var/lib/kubelet/pki/kubelet.crt -noout -ext extendedKeyUsage' | tail -1 | xargs)"
} > /opt/course/q4/kubelet-certs

# Question 5
kubectl drain "$Q5_NODE" --ignore-daemonsets --force --delete-emptydir-data --timeout=300s
kubectl taint node "$Q5_NODE" "dedicated=${Q5_TAINT}:NoSchedule" --overwrite
kubectl uncordon "$Q5_NODE"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata: { name: ${Q5_POD}, namespace: ${Q5_NS} }
spec:
  nodeSelector: { kubernetes.io/hostname: ${Q5_NODE} }
  tolerations: [{ key: dedicated, operator: Equal, value: ${Q5_TAINT}, effect: NoSchedule }]
  containers: [{ name: ${Q5_POD}, image: nginx:1.27-alpine }]
EOF
kubectl -n "$Q5_NS" wait --for=condition=Ready "pod/${Q5_POD}" --timeout=120s
kubectl -n "$Q2_NS" rollout status "deployment/${Q2_SA}-probe" --timeout=120s
