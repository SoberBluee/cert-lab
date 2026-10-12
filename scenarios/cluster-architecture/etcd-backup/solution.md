## Solution

Find the client URL and certificates from the etcd static Pod:

```bash
sudo grep -E 'listen-client-urls|cert-file|key-file|trusted-ca-file' /etc/kubernetes/manifests/etcd.yaml
```

Save the snapshot (the keys are root-only, so use sudo):

```bash
sudo mkdir -p /opt/backups
sudo ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /opt/backups/etcd-snapshot.db
```

Check it:

```bash
sudo ETCDCTL_API=3 etcdctl snapshot status /opt/backups/etcd-snapshot.db -w table
```

`snapshot status` reads the file directly and needs no certificates. Newer etcd releases move it to `etcdutl snapshot status`.
