Use context: `kubectl config use-context kubernetes-admin@kubernetes`

An etcd snapshot is stored at `${SNAPSHOT}` on `controlplane`. Restore it into data directory `${DATADIR}` on the same node.

Do **not** change the running etcd static Pod or its hostPath.
