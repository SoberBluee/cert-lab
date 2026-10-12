## Solution

```bash
kubectl get nodes                       # ${NODE} NotReady
ssh ${NODE}
sudo systemctl status kubelet           # inactive (dead), disabled
sudo systemctl enable --now kubelet
exit
kubectl get nodes -w                    # Ready within a few seconds
```

`start` alone fixes it until the next reboot; `enable` makes it permanent.
