## Solution

### Question 1: Upgrade the control plane and ${Q1_NODE}

Upgrade the control plane first: a kubelet must never be newer than the API server. On each node the order is kubeadm, then `kubeadm upgrade`, then the kubelet and kubectl. The packages are held, so unhold them before installing and hold them again after.

```bash
apt-cache madison kubeadm            # the exact package version, e.g. 1.37.1-1.1
```

**controlplane** (as root):

```bash
kubectl drain controlplane --ignore-daemonsets
apt-mark unhold kubeadm && apt-get install -y kubeadm='1.37.1-*' && apt-mark hold kubeadm
kubeadm upgrade plan
kubeadm upgrade apply v1.37.1
apt-mark unhold kubelet kubectl && apt-get install -y kubelet='1.37.1-*' kubectl='1.37.1-*' && apt-mark hold kubelet kubectl
systemctl daemon-reload && systemctl restart kubelet
kubectl uncordon controlplane
```

**The drain that never finishes.** `kubectl drain ${Q1_NODE} --ignore-daemonsets` cordons the node, then retries forever:

```
error when evicting pods/"${Q1_APP}-..." -n "${Q1_NS}" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.
```

`kubectl -n ${Q1_NS} get pdb` shows why: `MIN AVAILABLE 1`, `ALLOWED DISRUPTIONS 0`. With one replica, evicting it would leave zero, so the eviction API refuses. Stop the drain (Ctrl-C; the node stays cordoned) and give the budget room without changing it: a second replica lands on another node, because this one is cordoned.

```bash
kubectl -n ${Q1_NS} scale deployment ${Q1_APP} --replicas=2
kubectl -n ${Q1_NS} rollout status deployment ${Q1_APP}
kubectl drain ${Q1_NODE} --ignore-daemonsets      # now one Pod may go, and it does
```

Deleting the Pod by hand, or `kubectl drain --disable-eviction`, also gets past the budget, but both skip the protection it exists for: the app is down until the new Pod is ready.

**${Q1_NODE}** (`ssh ${Q1_NODE}`, then `sudo -i`). On a worker the kubeadm step is `kubeadm upgrade node`, not `apply`:

```bash
apt-mark unhold kubeadm kubelet kubectl
apt-get install -y kubeadm='1.37.1-*'
kubeadm upgrade node
apt-get install -y kubelet='1.37.1-*' kubectl='1.37.1-*'
apt-mark hold kubeadm kubelet kubectl
systemctl daemon-reload && systemctl restart kubelet
```

Back on controlplane: make the node schedulable and put the app back to one replica.

```bash
kubectl uncordon ${Q1_NODE}
kubectl -n ${Q1_NS} scale deployment ${Q1_APP} --replicas=1
kubectl get nodes        # controlplane and ${Q1_NODE} v1.37.1, the other worker still 1.36
```
