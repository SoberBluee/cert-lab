## Solution

### Question 1: Install a cluster

```bash
# Same as kubeadm init --pod-network-cidr ${Q1_CIDR} --node-name controlplane, with more time for a slow first start.
cat > /root/kubeadm-init.yaml <<EOF
apiVersion: kubeadm.k8s.io/v1beta4
kind: InitConfiguration
nodeRegistration:
  name: controlplane
timeouts:
  controlPlaneComponentHealthCheck: 10m0s
  kubernetesAPICall: 5m0s
---
apiVersion: kubeadm.k8s.io/v1beta4
kind: ClusterConfiguration
kubernetesVersion: $(kubeadm version -o short)
networking:
  podSubnet: ${Q1_CIDR}
EOF
if ! kubeadm init --config /root/kubeadm-init.yaml; then
  kubeadm reset -f
  kubeadm init --config /root/kubeadm-init.yaml
fi
mkdir -p /home/ubuntu/.kube
cp /etc/kubernetes/admin.conf /home/ubuntu/.kube/config
chown -R ubuntu:ubuntu /home/ubuntu/.kube
export KUBECONFIG=/etc/kubernetes/admin.conf
sed -E -e 's|^( *)# - name: CALICO_IPV4POOL_CIDR|\1- name: CALICO_IPV4POOL_CIDR|' -e "s|^( *)#   value: \"192.168.0.0/16\"|\1  value: \"${Q1_CIDR}\"|" /root/calico.yaml > /root/calico-lab.yaml
kubectl apply -f /root/calico-lab.yaml
join="$(kubeadm token create --print-join-command)"
for n in worker-1 worker-2; do
  sudo -u ubuntu ssh -o StrictHostKeyChecking=accept-new "$n" "sudo $join --node-name $n"
done
kubectl wait --for=condition=Ready nodes --all --timeout=600s
kubectl -n kube-system rollout status daemonset/calico-node --timeout=600s
kubectl -n kube-system rollout status deployment/coredns --timeout=300s
```
