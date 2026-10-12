## Solution

Pods stay `Pending` with no events from `default-scheduler`, so the scheduler is not running.

```bash
kubectl -n kube-system get pods
# kube-scheduler-controlplane   0/1   CrashLoopBackOff / RunContainerError

kubectl -n kube-system describe pod kube-scheduler-controlplane
# exec: "kube-schedular": executable file not found in $PATH
```

The scheduler is a static pod, so fix its manifest on the control plane node. Editing the mirror pod with kubectl has no effect.

```bash
ssh controlplane     # if you are not already there
sudo vim /etc/kubernetes/manifests/kube-scheduler.yaml
#   command:
#   - kube-scheduler          <- was kube-schedular
```

The kubelet watches the folder and recreates the pod within a few seconds:

```bash
kubectl -n kube-system get pod kube-scheduler-controlplane -w
kubectl get pods -l app=web -o wide
```

If the API server or kubectl is down in a similar scenario, use `crictl ps -a` and `crictl logs <id>` on the node instead.
