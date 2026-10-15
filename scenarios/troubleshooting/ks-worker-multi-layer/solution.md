## Solution

```bash
k get nodes                       # ${NODE} NotReady
ssh ${NODE}
sudo -i
systemctl status containerd kubelet
journalctl -u kubelet -n 30 --no-pager
journalctl -u containerd -n 30 --no-pager
```

Work layer by layer: fix what the logs show, restart, and read the logs again.

### The container runtime

<!-- fault RUNTIME_FAULT=endpoint -->
`/var/lib/kubelet/config.yaml` has `containerRuntimeEndpoint: unix:///var/run/crio/crio.sock`, but the node runs containerd (see `/etc/crictl.yaml` or `ls /run/containerd`). The kubelet log names the missing socket.

```bash
sed -i 's#unix:///var/run/crio/crio.sock#unix:///var/run/containerd/containerd.sock#' /var/lib/kubelet/config.yaml
```
<!-- /fault -->
<!-- fault RUNTIME_FAULT=containerd-config -->
The last line of `/etc/containerd/config.toml` is an unclosed `[plugins` table, so containerd fails with "failed to load TOML" (`journalctl -u containerd`).

```bash
tail -n 3 /etc/containerd/config.toml
sed -i '$d' /etc/containerd/config.toml     # remove the stray "[plugins" line
containerd config dump >/dev/null && echo parses
```
<!-- /fault -->
<!-- fault RUNTIME_FAULT=cni-removed -->
`/etc/cni/net.d` is empty, so containerd reports "cni plugin not initialized" and the node is `NotReady` with "container runtime network not ready" (`kubectl describe node`). The Calico conflist was moved to `/root/cni-backup` (or copy it from the healthy worker).

```bash
ls /etc/cni/net.d /root/cni-backup
mv /root/cni-backup/*.conflist /etc/cni/net.d/
```
<!-- /fault -->

### The kubelet

<!-- fault KUBELET_FAULT=binary-path -->
`systemctl status kubelet` shows `status=203/EXEC`. `systemctl cat kubelet` shows the kubeadm drop-in starts `/usr/local/bin/kubelet`, but `which kubelet` is `/usr/bin/kubelet`.

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value)   # the 10-kubeadm.conf drop-in
sed -i 's#ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
systemctl daemon-reload
```
<!-- /fault -->
<!-- fault KUBELET_FAULT=kubeconfig-flag -->
The kubelet exits right after start. `systemctl cat kubelet` shows `--kubeconfig=/etc/kubernetes/kubelet.config`, and `ls /etc/kubernetes` shows the real `kubelet.conf`.

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value)   # the 10-kubeadm.conf drop-in
sed -i 's#kubelet.config#kubelet.conf#' "$dropin"
systemctl daemon-reload
```
<!-- /fault -->
<!-- fault KUBELET_FAULT=api-port -->
The kubelet runs, but its log is full of `connection refused` for `:6444`. `/etc/kubernetes/kubelet.conf` points at the wrong API server port; the API server listens on `6443`.

```bash
sed -i 's#:6444$#:6443#' /etc/kubernetes/kubelet.conf
```
<!-- /fault -->
<!-- fault KUBELET_FAULT=client-ca -->
The kubelet exits with "unable to load client CA file /etc/kubernetes/pki/ca.pem". `ls /etc/kubernetes/pki` shows `ca.crt`.

```bash
sed -i 's#/etc/kubernetes/pki/ca.pem#/etc/kubernetes/pki/ca.crt#' /var/lib/kubelet/config.yaml
```
<!-- /fault -->

### Surviving a reboot

<!-- fault BOOT_FAULT=kubelet-disabled -->
The kubelet is running (or restarting) now, but `systemctl is-enabled kubelet` says `disabled`, so it would not come back after a reboot.
<!-- /fault -->
<!-- fault BOOT_FAULT=containerd-disabled -->
containerd is stopped and `systemctl is-enabled containerd` says `disabled`: nothing listens on the runtime socket, and nothing would after a reboot either.
<!-- /fault -->
<!-- fault BOOT_FAULT=both-disabled -->
containerd is stopped and disabled, and the kubelet is disabled too, so neither would come back after a reboot.
<!-- /fault -->

```bash
systemctl enable --now containerd
systemctl enable kubelet
systemctl restart containerd kubelet
systemctl is-enabled containerd kubelet    # enabled enabled
```

Back on `controlplane`:

```bash
k get node ${NODE} -w
k get pod node-probe -o wide
vim /opt/course/3/causes.txt               # one line for each of the three causes above
```
