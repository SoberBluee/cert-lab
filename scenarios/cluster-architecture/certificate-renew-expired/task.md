Use context: `kubectl config use-context kubernetes-admin@kubernetes`

`kubectl get` works on this cluster, but `kubectl logs` and `kubectl exec` fail with an authentication error, and `kubectl top` says the Metrics API is not available.

On `controlplane`:

1. Write the names of the expired certificates to `/opt/course/certs/expired.txt`, one per line, as `kubeadm certs check-expiration` lists them. Do this first, because the list changes once they are renewed.
2. Renew those certificates with `kubeadm`, and only those: leave every certificate that has not expired as it is, and do not change any certificate authority.
3. Make the running control plane use them, so that `kubectl logs` and `kubectl top` work again.
