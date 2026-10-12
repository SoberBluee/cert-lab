Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Before an upgrade, the team wants a backup of the cluster state.

On `controlplane`, take a snapshot of the running etcd and save it to:

```
/opt/backups/etcd-snapshot.db
```

The etcd certificates are in `/etc/kubernetes/pki/etcd`. `etcdctl` is installed. Create the directory if it does not exist.
