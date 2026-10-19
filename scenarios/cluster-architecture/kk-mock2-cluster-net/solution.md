# Mock 2 practice: cluster and networking

## q1 — Helm repo URL

```bash
helm repo list
echo -n 'http://controlplane:8879' > /opt/course/nginx-helm-url.txt
```

## q2 — etcd restore

```bash
sudo etcdutl snapshot restore ${Q2_SNAPSHOT} --data-dir ${Q2_DATADIR}
```

Do not retarget the live etcd Pod.

## q3 — CoreDNS `cka.local`

Edit ConfigMap `kube-system/coredns` so the `kubernetes` plugin line includes `cka.local` before (or with) `cluster.local`. Restart CoreDNS. Test:

```bash
kubectl run t --rm -it --image=busybox:1.36 --restart=Never -- nslookup kubernetes.default.svc.cka.local
```

## q4 — HTTPRoute instead of Ingress

Create HTTPRoute `${Q4_APP}-route` in `${Q4_NS}` attached to Gateway `traefik-gateway` / namespace `traefik` / section `web`, host `${Q4_APP}.${Q4_NS}.lab`, backend Service `${Q4_APP}:80`. Delete Ingress `${Q4_APP}`. Test:

```bash
curl -H 'Host: ${Q4_APP}.${Q4_NS}.lab' http://controlplane:30080/
```

## q5 — CNI restore

On the broken worker (`kubectl get nodes`): `/etc/cni/net.d` is empty; backup is `/root/cni-backup`. Move the conflist back, `systemctl restart containerd kubelet`.

## q6 — IP forwarding + containerd

```bash
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/k8s.conf
sudo sysctl --system
sudo systemctl enable --now containerd
```
