## Solution

### Question 1: Unhealthy worker

**The healthy setup**

- kubelet and containerd running and enabled on every worker, with `net.ipv4.ip_forward=1` persisted
- the kubelet's unit drop-in, `/var/lib/kubelet/config.yaml`, `/etc/kubernetes/kubelet.conf` and `/etc/default/kubelet` as kubeadm wrote them; no swap
- Calico's `10-calico.conflist` in `/etc/cni/net.d`, and a valid `/etc/containerd/config.toml`
- no worker cordoned or tainted

This run broke 3 things on `${Q1_NODE}`: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**, **`${Q1_FAULT_3}`**. Fix them in the order below.

**Problem 1: the container runtime or the network**

<!-- fault Q1_FAULT=containerd-stopped -->
#### containerd stopped and disabled (`containerd-stopped`)

The container runtime was stopped and disabled. The kubelet keeps running but reports `container runtime is down` / `NotReady`, and its log is full of CRI connection errors. `systemctl enable --now containerd` fixes it.

On the broken worker:

```bash
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=ip-forward-and-containerd -->
#### IP forwarding off and containerd disabled (`ip-forward-and-containerd`)

`net.ipv4.ip_forward` is 0, `/etc/sysctl.d/k8s.conf` is missing, and `containerd` was stopped and disabled. The node turns `NotReady`. Put `net.ipv4.ip_forward=1` in `/etc/sysctl.d/k8s.conf`, apply with `sysctl --system`, and `systemctl enable --now containerd`.

On the broken worker:

```bash
printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/k8s.conf
sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
systemctl enable --now containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=cni-config-removed -->
#### CNI configuration removed from the node (`cni-config-removed`)

The Calico network config (`10-calico.conflist`) is gone from `/etc/cni/net.d`. containerd reports the network as not ready, so the node turns `NotReady` with "container runtime network not ready ... cni plugin not initialized" (`kubectl describe node`, `journalctl -u kubelet`). `ls /etc/cni/net.d` is empty. Calico writes that file itself: delete the `calico-node` Pod on that worker (`kubectl -n kube-system delete pod -l k8s-app=calico-node --field-selector spec.nodeName=<node>`) and its `install-cni` init container writes it again. Copying it from the healthy worker also works if you change its `nodename`. Then restart containerd and the kubelet.

On the broken worker:

```bash
mv "/var/tmp/cka-q1.cni/"*.conflist /etc/cni/net.d/
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=containerd-config-invalid -->
#### containerd config does not parse (`containerd-config-invalid`)

The last line of `/etc/containerd/config.toml` is an unclosed `[plugins` table, so containerd fails to start ("failed to load TOML"). The kubelet runs but cannot reach the runtime, and the node turns `NotReady`. `systemctl status containerd` and `journalctl -u containerd -n 20` point at the line. Remove it, then restart containerd and the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q1.containerd" /etc/containerd/config.toml
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT=cni-conflist-typo -->
#### CNI conflist is present but invalid JSON (`cni-conflist-typo`)

A file still sits in `/etc/cni/net.d`, but it is not valid JSON (and names a bogus plugin): `python3 -m json.tool <file>` fails to parse it, and the runtime network never becomes ready, so the node turns `NotReady`. Calico writes that file itself: delete the broken file and the `calico-node` Pod on that worker, and its `install-cni` init container writes a good one. Then restart containerd and the kubelet.

On the broken worker:

```bash
f=$(ls /etc/cni/net.d/*.conflist 2>/dev/null | head -1)
[[ -f "/var/tmp/cka-q1.cni-conflist" ]] || { echo "missing CNI backup" >&2; exit 1; }
if [[ -n "$f" ]]; then cp -a "/var/tmp/cka-q1.cni-conflist" "$f"; else cp -a "/var/tmp/cka-q1.cni-conflist" /etc/cni/net.d/10-calico.conflist; fi
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->

**Problem 2: the kubelet**

<!-- fault Q1_FAULT_2=kubelet-stopped -->
#### kubelet stopped and disabled (`kubelet-stopped`)

The kubelet was stopped and disabled, so the node stops sending heartbeats and turns `NotReady`. `systemctl status kubelet` shows it inactive. `systemctl enable --now kubelet` fixes it now and after a reboot.

On the broken worker:

```bash
systemctl enable --now kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=kubelet-binary-path -->
#### kubelet unit points at the wrong binary (`kubelet-binary-path`)

The kubeadm drop-in (`10-kubeadm.conf`) starts `/usr/local/bin/kubelet`, which does not exist, so the service fails with `status=203/EXEC`. `systemctl cat kubelet` shows the path; `which kubelet` shows the real one. Fix the drop-in, then `systemctl daemon-reload` and restart the kubelet.

On the broken worker:

```bash
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
systemctl daemon-reload
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=kubelet-config-invalid -->
#### kubelet config has the wrong kind (`kubelet-config-invalid`)

`/var/lib/kubelet/config.yaml` says `kind: KubeletConfig`. The kubelet cannot decode its own config and exits at start (no kind "KubeletConfig" is registered), so the node turns `NotReady`. `journalctl -u kubelet` shows the error. Set `kind: KubeletConfiguration` again and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's/^kind: KubeletConfig$/kind: KubeletConfiguration/' /var/lib/kubelet/config.yaml
grep -qE -- '^kind: KubeletConfiguration$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=kubelet-client-ca -->
#### kubelet client CA file missing (`kubelet-client-ca`)

`authentication.x509.clientCAFile` in `/var/lib/kubelet/config.yaml` points at `/etc/kubernetes/pki/ca.pem`, which does not exist, so the kubelet exits with "unable to load client CA file". `ls /etc/kubernetes/pki` shows the real `ca.crt`. Fix the path and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#clientCAFile: /etc/kubernetes/pki/ca\.pem$#clientCAFile: /etc/kubernetes/pki/ca.crt#' /var/lib/kubelet/config.yaml
grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca\.crt$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=kubelet-api-port -->
#### kubelet kubeconfig uses the wrong API port (`kubelet-api-port`)

The kubelet runs, but `/etc/kubernetes/kubelet.conf` points it at port `6444` of the API server, so every request fails with "connection refused" and the node stops heartbeating. `journalctl -u kubelet` shows the URL; the API server listens on `6443` (compare `~/.kube/config`). Fix the port and restart the kubelet.

On the broken worker:

```bash
sed -i -E 's#^([[:space:]]*server: https://.*):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
grep -qE -- 'server: https://.*:6443$' /etc/kubernetes/kubelet.conf || { echo "could not edit /etc/kubernetes/kubelet.conf" >&2; exit 1; }
systemctl restart kubelet || true
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=kubelet-extra-args -->
#### kubelet started with an unknown flag (`kubelet-extra-args`)

`/etc/default/kubelet` adds `--pod-max-pids-limit=100` to `KUBELET_EXTRA_ARGS`. No such flag exists (the real one is `--pod-max-pids`), so the kubelet exits with "unknown flag" right after start. `systemctl cat kubelet` shows the drop-in reads that file. Remove the flag and restart the kubelet.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q1.kubelet-default" /etc/default/kubelet
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=kubelet-conf-missing -->
#### kubelet kubeconfig file is missing (`kubelet-conf-missing`)

`/etc/kubernetes/kubelet.conf` is gone, so the kubelet cannot authenticate to the API server and the node turns `NotReady`. `journalctl -u kubelet` mentions the missing kubeconfig. A worker's kubelet.conf only names the API server, the cluster CA and the path of the node's own client certificate (`/var/lib/kubelet/pki/kubelet-client-current.pem`), so the healthy worker's copy works unchanged: copy it across through controlplane, then restart the kubelet.

On the broken worker:

```bash
mv "/var/tmp/cka-q1.kubelet-conf" /etc/kubernetes/kubelet.conf
systemctl restart kubelet
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=kubelet-swap-on -->
#### Swap is enabled so the kubelet refuses to start (`kubelet-swap-on`)

A swap file (`/root/cka-swap`) is active and the kubelet runs with `failSwapOn: true`, so it exits rather than start with swap enabled. `swapon --show` lists the file; `journalctl -u kubelet` mentions swap. `swapoff` the file, remove it, and restart the kubelet.

On the broken worker:

```bash
swapoff /root/cka-swap 2>/dev/null || true
rm -f /root/cka-swap
sed -i '/^failSwapOn:/d' /var/lib/kubelet/config.yaml || true
systemctl restart kubelet
```
<!-- /fault -->

**Problem 3: scheduling**

<!-- fault Q1_FAULT_3=cordoned -->
#### Node cordoned (`cordoned`)

The node is `Ready` but cordoned (`SchedulingDisabled`), so no new Pods land on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q1_NODE}"
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=stray-taint -->
#### Stray NoSchedule taint (`stray-taint`)

A `maintenance=true:NoSchedule` taint keeps every Pod without a matching toleration off the node, including the probe Pod. `kubectl describe node` lists it under Taints; remove it with `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q1_NODE}" maintenance-
```
<!-- /fault -->
