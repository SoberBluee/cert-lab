#!/usr/bin/env bash
# Applied by "cka verify" on controlplane. Runs as root. Each question branches on its rolled variant.
set -euo pipefail

etcd() {
  ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/server.crt \
    --key=/etc/kubernetes/pki/etcd/server.key "$@"
}

# Question 1
cfg=/home/ubuntu/.kube/config
case "$Q1_KIND" in
  contexts-cert)
    kubectl --kubeconfig "$cfg" config get-contexts -o name > /opt/course/q1/contexts
    cat > /opt/course/q1/current-context.sh <<'EOF'
#!/usr/bin/env bash
awk '/^current-context:/ {print $2}' ~/.kube/config | tr -d '"'
EOF
    chmod +x /opt/course/q1/current-context.sh
    kubectl --kubeconfig "$cfg" config view --raw -o jsonpath="{.users[?(@.name==\"${Q1_USER}\")].user.client-certificate-data}" | base64 -d > "/opt/course/q1/${Q1_USER}.crt"
    ;;
  cluster-servers)
    for c in $(kubectl --kubeconfig "$cfg" config get-contexts -o name); do
      cl=$(kubectl --kubeconfig "$cfg" config view -o jsonpath="{.contexts[?(@.name==\"$c\")].context.cluster}")
      echo "$c $(kubectl --kubeconfig "$cfg" config view -o jsonpath="{.clusters[?(@.name==\"$cl\")].cluster.server}")"
    done > /opt/course/q1/servers
    kubectl --kubeconfig "$cfg" config view --raw -o jsonpath='{.clusters[?(@.name=="kubernetes")].cluster.certificate-authority-data}' | base64 -d > /opt/course/q1/ca.crt
    openssl x509 -in /opt/course/q1/ca.crt -noout -enddate > /opt/course/q1/ca-expiry
    ;;
  new-context)
    kubectl create namespace "team-${Q1_USER}"
    kubectl -n "team-${Q1_USER}" create rolebinding "${Q1_USER}-edit" --clusterrole=edit --user="$Q1_USER"
    kubectl --kubeconfig "$cfg" config set-context "${Q1_USER}-team" --cluster=kubernetes --user="$Q1_USER" --namespace="team-${Q1_USER}"
    chown -R ubuntu:ubuntu /home/ubuntu/.kube
    ;;
esac

# Question 2
kubectl -n "$Q2_NS" create serviceaccount "$Q2_SA"
case "$Q2_KIND" in
  deployer)
    kubectl -n "$Q2_NS" create role "${Q2_SA}-role" --verb=get,list,watch,create,update,patch --resource=deployments.apps
    kubectl -n "$Q2_NS" patch role "${Q2_SA}-role" --type=json -p '[{"op":"add","path":"/rules/-","value":{"apiGroups":[""],"resources":["pods"],"verbs":["get","list"]}}]'
    kubectl -n "$Q2_NS" create rolebinding "${Q2_SA}-role" --role="${Q2_SA}-role" --serviceaccount="${Q2_NS}:${Q2_SA}"
    kubectl create clusterrole "${Q2_SA}-nodes" --verb=get,list --resource=nodes
    kubectl create clusterrolebinding "${Q2_SA}-nodes" --clusterrole="${Q2_SA}-nodes" --serviceaccount="${Q2_NS}:${Q2_SA}"
    ;;
  configmap-editor)
    kubectl create clusterrole "${Q2_SA}-config" --verb=get,list,watch,create,update,patch,delete --resource=configmaps
    kubectl -n "$Q2_NS" create rolebinding "${Q2_SA}-config" --clusterrole="${Q2_SA}-config" --serviceaccount="${Q2_NS}:${Q2_SA}"
    ;;
  job-runner)
    kubectl -n "$Q2_NS" apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: ${Q2_SA}-role }
rules:
  - { apiGroups: [batch], resources: [jobs], verbs: [get, list, watch, create, delete] }
  - { apiGroups: [""], resources: [pods], verbs: [get, list, watch] }
  - { apiGroups: [""], resources: [pods/log], verbs: [get] }
EOF
    kubectl -n "$Q2_NS" create rolebinding "${Q2_SA}-role" --role="${Q2_SA}-role" --serviceaccount="${Q2_NS}:${Q2_SA}"
    kubectl create clusterrole "${Q2_SA}-nodes" --verb=get,list --resource=nodes
    kubectl create clusterrolebinding "${Q2_SA}-nodes" --clusterrole="${Q2_SA}-nodes" --serviceaccount="${Q2_NS}:${Q2_SA}"
    ;;
esac
if [[ "$Q2_KIND" == job-runner ]]; then
  kubectl -n "$Q2_NS" create job "${Q2_SA}-probe" --image=busybox:1.36 --dry-run=client -o json -- echo ok \
    | jq --arg sa "$Q2_SA" '.spec.template.spec.serviceAccountName = $sa' | kubectl apply -f -
else
  kubectl -n "$Q2_NS" create deployment "${Q2_SA}-probe" --image=nginx:1.27-alpine --dry-run=client -o json \
    | jq --arg sa "$Q2_SA" '.spec.template.spec.serviceAccountName = $sa' | kubectl apply -f -
fi

# Question 3
case "$Q3_KIND" in
  snapshot)
    etcd snapshot save /opt/course/q3/etcd-snapshot.db
    ETCDCTL_API=3 etcdctl snapshot status /opt/course/q3/etcd-snapshot.db -w table > /opt/course/q3/snapshot-status.txt
    ;;
  restore)
    etcd snapshot save /opt/course/q3/etcd-snapshot.db
    etcdutl snapshot restore /opt/course/q3/etcd-snapshot.db --data-dir /var/lib/etcd-restore-test
    ;;
  member-health)
    etcd member list -w table > /opt/course/q3/members.txt
    etcd endpoint health > /opt/course/q3/health.txt 2>&1
    etcd endpoint status -w table > /opt/course/q3/version.txt
    ;;
esac

# Question 4
case "$Q4_KIND" in
  apiserver-kubelet)
    openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate > /opt/course/q4/apiserver-expiry
    echo "kubeadm certs renew apiserver" > /opt/course/q4/renew.sh
    remote() { sudo -u ubuntu ssh -o StrictHostKeyChecking=accept-new "$Q4_NODE" "sudo $1"; }
    {
      echo "client issuer: $(remote 'openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -issuer')"
      echo "client usage: $(remote 'openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -ext extendedKeyUsage' | tail -1 | sed 's/^ *//')"
      echo "server issuer: $(remote 'openssl x509 -in /var/lib/kubelet/pki/kubelet.crt -noout -issuer')"
      echo "server usage: $(remote 'openssl x509 -in /var/lib/kubelet/pki/kubelet.crt -noout -ext extendedKeyUsage' | tail -1 | sed 's/^ *//')"
    } > /opt/course/q4/kubelet-certs
    ;;
  etcd-server)
    openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -ext subjectAltName | tail -n +2 > /opt/course/q4/etcd-sans
    openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -enddate > /opt/course/q4/etcd-expiry
    echo "kubeadm certs renew etcd-server" > /opt/course/q4/renew.sh
    ;;
  front-proxy)
    openssl x509 -in /etc/kubernetes/pki/front-proxy-client.crt -noout -issuer > /opt/course/q4/front-proxy-issuer
    grep -oE -- '--(requestheader-client-ca-file|proxy-client-cert-file)=[^ ]+' /etc/kubernetes/manifests/kube-apiserver.yaml > /opt/course/q4/front-proxy-flags
    echo "kubeadm certs renew front-proxy-client" > /opt/course/q4/renew.sh
    ;;
esac

# Question 5
q5_pod() {
  kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata: { name: ${Q5_POD}, namespace: ${Q5_NS} }
spec:
  nodeSelector: { kubernetes.io/hostname: ${Q5_NODE} }
  tolerations: [$1]
  containers: [{ name: ${Q5_POD}, image: nginx:1.27-alpine }]
EOF
  kubectl -n "$Q5_NS" wait --for=condition=Ready "pod/${Q5_POD}" --timeout=120s
}
case "$Q5_KIND" in
  drain-dedicate)
    kubectl drain "$Q5_NODE" --ignore-daemonsets --force --delete-emptydir-data --timeout=300s
    kubectl taint node "$Q5_NODE" "dedicated=${Q5_TAINT}:NoSchedule" --overwrite
    kubectl uncordon "$Q5_NODE"
    q5_pod "{ key: dedicated, operator: Equal, value: ${Q5_TAINT}, effect: NoSchedule }"
    ;;
  noexecute-evict)
    kubectl taint node "$Q5_NODE" "dedicated=${Q5_TAINT}:NoExecute" --overwrite
    q5_pod "{ key: dedicated, operator: Equal, value: ${Q5_TAINT}, effect: NoExecute, tolerationSeconds: 3600 }"
    kubectl -n "$Q5_NS" rollout status "deployment/$Q5_APP" --timeout=180s
    ;;
  cordon-move)
    kubectl cordon "$Q5_NODE"
    kubectl label node "$Q5_NODE" maintenance=true --overwrite
    kubectl -n "$Q5_NS" patch deployment "$Q5_APP" --type=merge -p '{"spec":{"template":{"spec":{"affinity":{"nodeAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"maintenance","operator":"NotIn","values":["true"]}]}]}}}}}}}'
    kubectl -n "$Q5_NS" rollout status "deployment/$Q5_APP" --timeout=240s
    ;;
esac

if [[ "$Q2_KIND" == job-runner ]]; then
  kubectl -n "$Q2_NS" wait --for=condition=Complete "job/${Q2_SA}-probe" --timeout=120s
else
  kubectl -n "$Q2_NS" rollout status "deployment/${Q2_SA}-probe" --timeout=120s
fi
