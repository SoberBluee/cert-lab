## Solution

### Question 1: Read etcd's own facts

`etcdctl` needs the endpoint and the client certificates, or it fails with `context deadline exceeded`. They are in `/etc/kubernetes/manifests/etcd.yaml`. A shell function saves repeating them:

```bash
e() { sudo etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key "$@"; }
e member list | cut -d, -f1 > /opt/course/etcd/member-id.txt
e endpoint status | cut -d, -f3 | tr -d ' ' > /opt/course/etcd/version.txt
e get /registry/namespaces --prefix --keys-only | grep -c registry > /opt/course/etcd/namespace-keys.txt
```

`etcdctl version` would show the **client's** version, which can differ from the server's. That is why the task points you at `endpoint status`.

### Question 2: Find Secret ${Q2_SECRET} in etcd

Kubernetes stores objects under `/registry/<resource>/<namespace>/<name>`. Reading the key shows the Secret's value in the output.

```bash
echo /registry/secrets/${Q2_NS}/${Q2_SECRET} > /opt/course/etcd/secret-key.txt
e get /registry/secrets/${Q2_NS}/${Q2_SECRET} | grep -a apikey -A1
echo plain > /opt/course/etcd/secret-storage.txt
```

The value is plain text because this cluster has no encryption at rest. Base64 in `kubectl get secret -o yaml` is only an encoding: anyone who can read etcd or its backups can read every Secret. The fix would be an `EncryptionConfiguration` passed to the API server with `--encryption-provider-config`.
