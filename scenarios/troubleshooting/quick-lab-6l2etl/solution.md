## Solution

### Question 1: Ready, but one worker misbehaves

**The healthy setup**

- three Nodes, and both workers labelled `fleet=edge`, which is what `fleet-check` selects
- the API server reaches the kubelet on port `10250`, and nodes reach each other over Calico's overlay (VXLAN, or IP-in-IP on Multipass), with no extra firewall rule or service on the node
- `clusterDNS` in `/var/lib/kubelet/config.yaml` is the ClusterIP of Service `kube-dns`
- `sandbox` in `/etc/containerd/config.toml` names the pause image the node has, `registry.k8s.io/pause:3.10.1`
- `/opt/cni/bin` holds the `calico` plugin
- the root filesystem has room to spare, with no node under `DiskPressure`

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=kubelet-port-blocked -->
#### A firewall rule blocks the kubelet port (`kubelet-port-blocked`)

Service `node-hardening` keeps a firewall rule in place that rejects port `10250`. The kubelet talks out to the API server, so the node stays `Ready` and its Pods run, but everything that goes the other way fails: `kubectl logs` and `kubectl exec` end with `dial tcp <node-ip>:10250: connect: connection refused`. `ss -ltnp | grep 10250` shows that the kubelet does listen, which points at the path; `iptables -S INPUT` shows the rule. Delete it and it is back within seconds, because `systemctl list-units --type=service --state=running` has a service the healthy worker lacks. Disable that service, remove it and delete the rule.

On the broken worker:

```bash
systemctl disable --now node-hardening
rm -f /etc/systemd/system/node-hardening.service /usr/local/sbin/node-hardening
systemctl daemon-reload
iptables -t filter -D INPUT -p tcp --dport 10250 -j REJECT --reject-with tcp-reset 2>/dev/null || true
```

Then, on the controlplane:

```bash
echo "${Q1_NODE}" > /opt/course/degraded/worker.txt
echo firewall >> /opt/course/degraded/cause.txt
```
<!-- /fault -->

<!-- fault Q1_FAULT=cluster-dns-wrong -->
#### The kubelet hands Pods the wrong DNS server (`cluster-dns-wrong`)

`clusterDNS` in `/var/lib/kubelet/config.yaml` says `10.96.0.53`, which is no Service. The kubelet writes that address into every new Pod, so Pods started on this worker cannot resolve anything, while older Pods keep working. The Pod's readiness probe times out on `nslookup`; `kubectl exec <pod> -- cat /etc/resolv.conf` differs between the workers, and `kubectl -n kube-system get service kube-dns` shows the right address. Fix the file and restart the kubelet. A Pod keeps the `resolv.conf` it started with, so delete the Pod on that worker as well.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q1.kubelet-config" /var/lib/kubelet/config.yaml
systemctl restart kubelet
```

Then, on the controlplane:

```bash
kubectl -n "${Q1_NS}" delete pod -l app=fleet-check --field-selector "spec.nodeName=${Q1_NODE}" --wait=false >/dev/null
echo "${Q1_NODE}" > /opt/course/degraded/worker.txt
echo kubelet >> /opt/course/degraded/cause.txt
```
<!-- /fault -->

<!-- fault Q1_FAULT=sandbox-image-wrong -->
#### containerd names a sandbox image that does not exist (`sandbox-image-wrong`)

`sandbox` in `/etc/containerd/config.toml` names `registry.k8s.io/pause:3.10.9`, an image that does not exist. Running Pods are fine, but every new Pod needs a sandbox first, so it stays in `ContainerCreating` and `kubectl describe pod` shows `FailedCreatePodSandBox ... failed to get sandbox image`. `crictl images | grep pause` and the same line on the healthy worker show the right tag. Fix it and restart containerd; the Pod starts on the kubelet's next try.

On the broken worker:

```bash
cp -a "/var/tmp/cka-q1.containerd" /etc/containerd/config.toml
systemctl restart containerd
```

Then, on the controlplane:

```bash
echo "${Q1_NODE}" > /opt/course/degraded/worker.txt
echo containerd >> /opt/course/degraded/cause.txt
```
<!-- /fault -->

<!-- fault Q1_FAULT=cni-binary-missing -->
#### The Calico CNI plugin binary is gone from the node (`cni-binary-missing`)

`/opt/cni/bin/calico` is gone. The node stays `Ready`, because containerd only checks that a CNI configuration exists, and running Pods keep their network. Any Pod that starts or stops needs the plugin, though: a new Pod sits in `ContainerCreating` with `failed to find plugin "calico" in path [/opt/cni/bin]`, and a deleted one stays `Terminating` (`journalctl -u kubelet` shows the same message for its sandbox). `ls /opt/cni/bin` shows `calico-ipam` but no `calico`. Calico installs that binary itself: delete the `calico-node` Pod on that worker, and its `install-cni` init container puts it back.

```bash
kubectl -n kube-system delete pod -l k8s-app=calico-node --field-selector "spec.nodeName=${Q1_NODE}" --wait=false
echo "${Q1_NODE}" > /opt/course/degraded/worker.txt
echo cni >> /opt/course/degraded/cause.txt
```
<!-- /fault -->

<!-- fault Q1_FAULT=overlay-blocked -->
#### A firewall rule blocks the Pod network overlay (`overlay-blocked`)

Service `node-hardening` drops Calico's overlay traffic as it reaches this worker (UDP port `4789` for VXLAN, IP protocol `4` for IP-in-IP). Node-to-node traffic is untouched, so the node stays `Ready` and `kubectl` works. Pods on the worker reach each other, but nothing that crosses to another node: `wget` from a Pod to a Pod on the other worker times out, and DNS fails when CoreDNS runs elsewhere, which is why the readiness probe fails. Test by Pod IP within and across nodes to narrow it down, then look at the firewall: the rules are in the raw table, which `iptables -t raw -S PREROUTING` shows. They come back until the service is disabled and removed, so do that and then delete them.

On the broken worker:

```bash
systemctl disable --now node-hardening
rm -f /etc/systemd/system/node-hardening.service /usr/local/sbin/node-hardening
systemctl daemon-reload
iptables -t raw -D PREROUTING -p udp --dport 4789 -j DROP 2>/dev/null || true
iptables -t raw -D PREROUTING -p 4 -j DROP 2>/dev/null || true
```

Then, on the controlplane:

```bash
echo "${Q1_NODE}" > /opt/course/degraded/worker.txt
echo firewall >> /opt/course/degraded/cause.txt
```
<!-- /fault -->

<!-- fault Q1_FAULT=disk-full -->
#### A large file fills the root filesystem (`disk-full`)

`/var/log/journal-archive/capture.tar` fills the root filesystem past the kubelet's limit of 10% free. The node stays `Ready`, but reports `DiskPressure`, gets the `node.kubernetes.io/disk-pressure` taint and evicts its Pods: `kubectl describe node` and the Pods' `Evicted` status show it. `df -h /` confirms it, and `du -sh /var/log/* | sort -h` leads to the file. Delete it. The kubelet holds the condition for 5 minutes after the disk recovers (`evictionPressureTransitionPeriod`); restarting it clears the condition at once.

On the broken worker:

```bash
rm -rf /var/log/journal-archive
systemctl restart kubelet
```

Then, on the controlplane:

```bash
echo "${Q1_NODE}" > /opt/course/degraded/worker.txt
echo disk >> /opt/course/degraded/cause.txt
```
<!-- /fault -->

<!-- fault Q1_FAULT=node-object-deleted -->
#### The worker's Node object was deleted (`node-object-deleted`)

Someone ran `kubectl delete node`. `kubectl get nodes` no longer lists the worker, and the Pod garbage collector removed its Pods, but the machine is fine and its kubelet runs. `journalctl -u kubelet` is full of `nodes "<node>" not found`: a kubelet registers once, at start. Restart it and the Node is back, with a new age and without the labels it had. So `fleet-check` still skips it until you add `fleet=edge` again, as `kubectl get nodes --show-labels` shows on the other worker and `kubectl -n ${Q1_NS} get daemonset fleet-check -o wide` shows in the selector.

On the broken worker:

```bash
systemctl restart kubelet
```

Then, on the controlplane:

```bash
until kubectl get node "${Q1_NODE}" >/dev/null 2>&1; do sleep 2; done
kubectl label node "${Q1_NODE}" fleet=edge --overwrite
echo "${Q1_NODE}" > /opt/course/degraded/worker.txt
echo node-registration >> /opt/course/degraded/cause.txt
```
<!-- /fault -->
