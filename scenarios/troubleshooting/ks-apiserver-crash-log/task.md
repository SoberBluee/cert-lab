Use context: `kubectl config use-context kubernetes-admin@kubernetes`

A colleague "hardened" the kube-apiserver configuration on `controlplane`. Since then, `kubectl` only answers with `connection refused`.

1. Find the error that stops the kube-apiserver at startup, and write that log line to `/opt/course/1/apiserver-error.log` on `controlplane`. The line from the container log is enough; the timestamp prefix may stay.
2. Fix the cluster so that the API server answers again and `etcd`, `kube-apiserver`, `kube-controller-manager` and `kube-scheduler` all run Ready.

Constraints:

- Keep authorization mode `Node,RBAC`, and do not disable any admission plugin or authentication method that kubeadm enabled.
- Do not change anything in `/etc/kubernetes/pki`.
