## Solution

### Question 1: Worker after a configuration change

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-kubeconfig-server -->
#### kubelet kubeconfig points at the wrong API server port (`kubelet-kubeconfig-server`)

`server:` in `/etc/kubernetes/kubelet.conf` on the worker uses port `6444`, where nothing listens. The kubelet keeps running but cannot post its status, so the node turns `NotReady`; `journalctl -u kubelet` is full of `connection refused` for `:6444`. Set the port back to `6443` and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
grep -qE -- 'server: https://[^[:space:]]+:6443$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubelet-client-ca -->
#### kubelet client CA file path is wrong (`kubelet-client-ca`)

`authentication.x509.clientCAFile` in `/var/lib/kubelet/config.yaml` points at `/etc/kubernetes/pki/ca.pem`, which does not exist, so the kubelet exits at startup (`unable to load client CA file`) and systemd keeps restarting it. `ls /etc/kubernetes/pki` shows `ca.crt`. Fix the path and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*clientCAFile: /etc/kubernetes/pki/)ca\.pem$#\1ca.crt#' /var/lib/kubelet/config.yaml
grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca.crt$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubelet-config-flag -->
#### kubelet unit loads a configuration file that does not exist (`kubelet-config-flag`)

The kubeadm drop-in (`10-kubeadm.conf`) starts the kubelet with `--config=/var/lib/kubelet/kubelet-config.yaml`, which does not exist, so it exits with `failed to load Kubelet config file`. `systemctl cat kubelet` shows the flag and `ls /var/lib/kubelet` shows `config.yaml`. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i -E 's#--config=/var/lib/kubelet/kubelet-config\.yaml#--config=/var/lib/kubelet/config.yaml#' "$dropin"
grep -qE -- '--config=/var/lib/kubelet/config.yaml' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubelet-kubeconfig-flag -->
#### kubelet unit loads a kubeconfig that does not exist (`kubelet-kubeconfig-flag`)

The kubeadm drop-in starts the kubelet with `--kubeconfig=/etc/kubernetes/kubelet.config`. That file does not exist and the bootstrap kubeconfig is long gone, so the kubelet exits right after start and the node turns `NotReady`. `systemctl cat kubelet` shows the flag; `ls /etc/kubernetes` shows the real `kubelet.conf`. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i -E 's#--kubeconfig=/etc/kubernetes/kubelet\.config#--kubeconfig=/etc/kubernetes/kubelet.conf#' "$dropin"
grep -qE -- '--kubeconfig=/etc/kubernetes/kubelet.conf' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubelet-serving-cert -->
#### kubelet serving certificate file missing (`kubelet-serving-cert`)

`/var/lib/kubelet/config.yaml` sets `tlsCertFile` and `tlsPrivateKeyFile` to `/var/lib/kubelet/pki/kubelet-server.*`, which do not exist, so the kubelet cannot load its serving certificate and exits at start. `journalctl -u kubelet` names the file, and `ls /var/lib/kubelet/pki` shows only the self-generated `kubelet.crt`/`kubelet.key` and the client certificates. Remove both lines (the kubelet then uses its self-signed certificate) and restart it.

On the broken worker:

```bash
sed -i -E '/^tls(CertFile|PrivateKeyFile): /d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=kubelet-max-pods -->
#### kubelet allows only two Pods (`kubelet-max-pods`)

`/var/lib/kubelet/config.yaml` sets `maxPods: 2`. calico-node and kube-proxy already fill those two slots, so the kubelet rejects the `node-agent` Pod with `OutOfpods` and the DaemonSet never gets ready there, although the node stays `Ready`. `kubectl describe node` shows `pods: 2` under Capacity, and `kubectl get pods -o wide` shows the rejected Pods. Remove `maxPods` (the default is 110) and restart the kubelet.

On the broken worker:

```bash
sed -i '/^maxPods:/d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->
