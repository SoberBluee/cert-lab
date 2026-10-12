## Solution

```bash
kubectl -n kube-system get pods -o wide | grep ${NAME}     # ${NAME}-${NODE}  ErrImagePull
kubectl -n kube-system describe pod ${NAME}-${NODE}         # image "${BAD_IMAGE}" not found
ssh ${NODE}
sudo grep staticPodPath /var/lib/kubelet/config.yaml        # /etc/kubernetes/manifests
sudo vim /etc/kubernetes/manifests/${NAME}.yaml             # image: nginx:1.27-alpine
exit
kubectl -n kube-system get pod ${NAME}-${NODE} -w
```

Deleting the mirror Pod with kubectl does nothing useful: the kubelet recreates it from the file.
