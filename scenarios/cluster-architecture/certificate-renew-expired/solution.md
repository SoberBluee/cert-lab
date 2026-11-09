# Renew expired client certificates

Plain `kubectl get` only talks to the API server, so it works. The failing commands make the API server call something else:

- `kubectl logs` and `exec`: the API server connects to the kubelet with `apiserver-kubelet-client`. The kubelet rejects it, which you see as a credentials error.
- `kubectl top`: the API server proxies to metrics-server with `front-proxy-client`. The APIService goes `False (FailedDiscoveryCheck)`, so the Metrics API looks unavailable.

`kubeadm certs check-expiration` shows `<invalid>` for both. Record them first, then renew exactly those two. `kubeadm certs renew all` would also replace certificates that were fine.

```bash
sudo kubeadm certs check-expiration
sudo kubeadm certs renew apiserver-kubelet-client
sudo kubeadm certs renew front-proxy-client
```

Renewing only writes the files. The API server read them when it started, so restart it. It is a static Pod, and `kubectl delete pod` only removes the mirror Pod, so move the manifest out and back:

```bash
sudo mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/
sudo crictl ps --name kube-apiserver   # wait until it is gone
sudo mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/
```

`kubectl top` can take a minute longer: metrics-server has to reconnect after the API server comes back.
