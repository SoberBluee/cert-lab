## Solution

### Question 1: Upgrade a worker

```bash
kubectl drain worker-1 --ignore-daemonsets --delete-emptydir-data
runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new worker-1 sudo bash -s <<'CKA_NODE_EOF'
set -euo pipefail
. /opt/cka/versions.env
export DEBIAN_FRONTEND=noninteractive
apt-mark unhold kubeadm >/dev/null
apt-get install -y -q "kubeadm=$CURRENT_PKG" >/dev/null
apt-mark hold kubeadm >/dev/null
kubeadm upgrade node
apt-mark unhold kubelet >/dev/null
apt-get install -y -q "kubelet=$CURRENT_PKG" >/dev/null
apt-mark hold kubelet >/dev/null
apt-mark unhold kubectl >/dev/null
apt-get install -y -q "kubectl=$CURRENT_PKG" >/dev/null
apt-mark hold kubectl >/dev/null
systemctl daemon-reload
systemctl restart kubelet
CKA_NODE_EOF
kubectl uncordon worker-1
kubectl wait --for=condition=Ready node/worker-1 --timeout=300s
```
