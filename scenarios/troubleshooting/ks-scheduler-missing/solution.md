## Solution

### 1. Schedule the Pod by hand

The scheduler's only job is to set `spec.nodeName`. Without a scheduler you can set it yourself, but `nodeName` cannot be changed on an existing Pod, so the Pod has to be recreated:

```bash
k -n ${NS} get pod manual-${APP} -o yaml > manual.yaml
vim manual.yaml
# spec:
#   nodeName: controlplane       <- add
k replace --force -f manual.yaml
k -n ${NS} get pod manual-${APP} -o wide    # Running on controlplane
```

A Pod with `nodeName` set skips the scheduler entirely, so the control plane's `NoSchedule` taint does not apply to it. Taints are a scheduling rule; the kubelet only acts on `NoExecute`.

### 2. Bring the scheduler back

```bash
k -n kube-system get pods
ssh controlplane
ls /etc/kubernetes/manifests
sudo crictl ps -a | grep scheduler
```

<!-- fault SCHED_FAULT=moved -->
There is no `kube-scheduler-controlplane` Pod at all, and `kube-scheduler.yaml` is missing from the manifests folder. Someone moved it:

```bash
sudo find / -name kube-scheduler.yaml -not -path '/proc/*' 2>/dev/null
# ${HIDE_DIR}/kube-scheduler.yaml
sudo mv ${HIDE_DIR}/kube-scheduler.yaml /etc/kubernetes/manifests/
```
<!-- /fault -->
<!-- fault SCHED_FAULT=kubeconfig-path -->
`kube-scheduler-controlplane` is in `CrashLoopBackOff`. `k -n kube-system logs kube-scheduler-controlplane` (or `crictl logs`) says `stat /etc/kubernetes/scheduler.config: no such file or directory`. The manifest passes `--kubeconfig=/etc/kubernetes/scheduler.config`; the file kubeadm wrote (and mounts into the Pod) is `scheduler.conf`:

```bash
sudo sed -i 's#--kubeconfig=/etc/kubernetes/scheduler.config#--kubeconfig=/etc/kubernetes/scheduler.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml
```
<!-- /fault -->
<!-- fault SCHED_FAULT=image-tag -->
`kube-scheduler-controlplane` is in `ImagePullBackOff`. `k -n kube-system describe pod kube-scheduler-controlplane` shows the image tag ends in `-patched`, which does not exist. Compare with the tag of `kube-controller-manager.yaml` and remove the suffix:

```bash
sudo sed -i 's#-patched$##' /etc/kubernetes/manifests/kube-scheduler.yaml
```
<!-- /fault -->
<!-- fault SCHED_FAULT=command -->
`kube-scheduler-controlplane` shows `RunContainerError` / `StartError`: `exec: "kube-schedular": executable file not found`. The first entry of `command:` in the manifest is misspelled:

```bash
sudo sed -i 's#- kube-schedular$#- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
```
<!-- /fault -->

The kubelet (re)starts the static Pod within seconds. Once it holds the leader lease, the Pending Pods of `${APP}` are scheduled onto the workers:

```bash
k -n kube-system get pod kube-scheduler-controlplane
k -n ${NS} get pods -o wide
```
