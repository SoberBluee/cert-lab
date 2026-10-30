## Solution

### Question 1: Cluster network facts

```bash
grep -oE -- '--cluster-cidr=[^ "]+' /etc/kubernetes/manifests/kube-controller-manager.yaml | cut -d= -f2 > /opt/course/facts/pod-cidr
grep -oE -- '--service-cluster-ip-range=[^ "]+' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2 > /opt/course/facts/service-cidr
kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.clusterIP}' > /opt/course/facts/dns-ip
curl -s http://127.0.0.1:10249/proxyMode > /opt/course/facts/proxy-mode
conf="/etc/cni/net.d/$(ls /etc/cni/net.d/ | grep -E '\.(conf|conflist|json)$' | sort | head -1)"
jq -r '.plugins[0].type' "$conf" > /opt/course/facts/cni
echo "$conf" > /opt/course/facts/cni-config
```
