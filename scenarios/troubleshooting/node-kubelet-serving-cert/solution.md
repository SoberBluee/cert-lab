## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-serving-cert -->
#### kubelet serving certificate file missing (`kubelet-serving-cert`)

`/var/lib/kubelet/config.yaml` sets `tlsCertFile` and `tlsPrivateKeyFile` to `/var/lib/kubelet/pki/kubelet-server.*`, which do not exist, so the kubelet cannot load its serving certificate and exits at start. `journalctl -u kubelet` names the file, and `ls /var/lib/kubelet/pki` shows only the self-generated `kubelet.crt`/`kubelet.key` and the client certificates. Remove both lines (the kubelet then uses its self-signed certificate) and restart it.

On the broken worker:

```bash
sed -i -E '/^tls(CertFile|PrivateKeyFile): /d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->
