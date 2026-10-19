# IP forwarding and containerd

```bash
echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/k8s.conf
sudo sysctl --system
sudo systemctl enable --now containerd
```
