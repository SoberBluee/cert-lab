## Solution

### Question 1: Restore etcd

```bash
etcdutl snapshot restore "${Q1_SNAPSHOT}" --data-dir "${Q1_DATADIR}"
sed -i -E "s#path: /var/lib/etcd\$#path: ${Q1_DATADIR}#" /etc/kubernetes/manifests/etcd.yaml
grep -q -- "path: ${Q1_DATADIR}" /etc/kubernetes/manifests/etcd.yaml
# Once etcd runs from the restored directory, restart the API server: it caches what it read from
# etcd, does not notice the restore, and would go on listing after-backup.
for _ in $(seq 1 60); do
  etcd=$(crictl ps --name '^etcd$' -q 2>/dev/null | head -1)
  [[ -n "$etcd" ]] && crictl inspect "$etcd" 2>/dev/null | grep -q -- "${Q1_DATADIR}" && break
  sleep 2
done
crictl ps --name kube-apiserver -q | xargs -r crictl stop
for _ in $(seq 1 240); do
  [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
  sleep 2
done
for _ in $(seq 1 120); do
  [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
  sleep 3
done
[[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]]
```
