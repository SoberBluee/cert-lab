## Solution

### Question 1: Unhealthy worker

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-client-ca -->
#### kubelet client CA file missing (`kubelet-client-ca`)

`authentication.x509.clientCAFile` in `/var/lib/kubelet/config.yaml` points at `/etc/kubernetes/pki/ca.pem`, which does not exist, so the kubelet exits with "unable to load client CA file". `ls /etc/kubernetes/pki` shows the real `ca.crt`. Fix the path and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#clientCAFile: /etc/kubernetes/pki/ca\.pem$#clientCAFile: /etc/kubernetes/pki/ca.crt#' /var/lib/kubelet/config.yaml
grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca\.crt$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->
