## Solution

### Question 1: New workloads never start

**The healthy setup**

- `kube-scheduler` and `kube-controller-manager` run as static Pods from `/etc/kubernetes/manifests`, with the commands, flags, kubeconfigs, keys and images kubeadm wrote

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=scheduler-missing-file -->
#### A scheduler flag points at a file that does not exist (`scheduler-missing-file`)

In this run the scheduler's `--${Q1_SCHEDULER_FILE}` flag in `/etc/kubernetes/manifests/kube-scheduler.yaml` names a file that does not exist, so the scheduler exits at startup and the new `web` Pods stay `Pending` with no scheduling events. `kubectl -n kube-system logs kube-scheduler-controlplane` (or `crictl logs`) names the file. The two ways this fault breaks the scheduler:

- `--kubeconfig` points at `/etc/kubernetes/scheduler.config`; `ls /etc/kubernetes` shows the real `scheduler.conf`
- an added `--config=/etc/kubernetes/sched-config.yaml`, a scheduler configuration that was never written: remove the flag (kubeadm's scheduler needs no `--config`), or write the file

```bash
case "${Q1_SCHEDULER_FILE}" in
  kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/scheduler.conf$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
    ;;
  config)
    sed -i -E '\#^[[:space:]]*- --config=/etc/kubernetes/sched-config.yaml$#d' /etc/kubernetes/manifests/kube-scheduler.yaml
    ! grep -qE -- '- --config=' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not remove scheduler --config" >&2; exit 1; }
    ;;
esac
```
<!-- /fault -->

<!-- fault Q1_FAULT=controller-manager-missing-file -->
#### A controller manager flag points at a file that does not exist (`controller-manager-missing-file`)

In this run `--${Q1_CM_FILE}` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` names a file that does not exist. The controller manager exits at startup, so `web` is scaled to 2 but no ReplicaSet creates Pods: `kubectl get deploy` shows 0 of 2 and there are no Pods at all, which tells it apart from a broken scheduler (Pods that stay `Pending`). Its logs name the missing file. Every flag this fault can break:

- `--kubeconfig`: `/etc/kubernetes/controller-manager.conf` (broken: `/etc/kubernetes/controller-manager.config`)
- `--service-account-private-key-file`: `/etc/kubernetes/pki/sa.key` (broken: `/etc/kubernetes/pki/sa.pem`)

```bash
case "${Q1_CM_FILE}" in
  kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=)/etc/kubernetes/controller-manager.config$#\1/etc/kubernetes/controller-manager.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  service-account-private-key-file)
    sed -i -E 's#^([[:space:]]*- --service-account-private-key-file=)/etc/kubernetes/pki/sa.pem$#\1/etc/kubernetes/pki/sa.key#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --service-account-private-key-file=/etc/kubernetes/pki/sa.key$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q1_CM_FILE}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-command -->
#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-image-tag -->
#### Scheduler image tag does not exist (`scheduler-image-tag`)

The image in `/etc/kubernetes/manifests/kube-scheduler.yaml` has tag `v0.0.0`, which does not exist. The kubelet cannot pull it (`ErrImagePull` in `kubectl -n kube-system describe pod kube-scheduler-controlplane`, or `crictl ps -a` shows no scheduler), so new Pods stay `Pending`. Use the same tag as the other control plane images (`grep image: /etc/kubernetes/manifests/*.yaml`, or `kubeadm config images list`).

```bash
sed -i -E "s#kube-scheduler:v0\.0\.0#$(cat "/var/tmp/cka-q1.scheduler-image")#" /etc/kubernetes/manifests/kube-scheduler.yaml
grep -q 'kube-scheduler:v0\.0\.0' /etc/kubernetes/manifests/kube-scheduler.yaml && { echo "could not restore the scheduler image" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-manifest-removed -->
#### Scheduler static Pod manifest is missing (`scheduler-manifest-removed`)

`/etc/kubernetes/manifests/kube-scheduler.yaml` was moved aside, so the kubelet stops the scheduler and new Pods stay `Pending`. `ls /etc/kubernetes/manifests` is missing the file; restore it from `/var/tmp/cka-kube-scheduler.yaml`.

```bash
mv /var/tmp/cka-kube-scheduler.yaml /etc/kubernetes/manifests/kube-scheduler.yaml
[[ -f /etc/kubernetes/manifests/kube-scheduler.yaml ]]
```
<!-- /fault -->

<!-- fault Q1_FAULT=scheduler-manifest-yaml -->
#### Scheduler manifest is not valid YAML (`scheduler-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-scheduler.yaml` is indented by three spaces instead of four, so the kubelet cannot parse the manifest and drops the scheduler Pod. New `web` Pods stay `Pending`. `journalctl -u kubelet` reports the bad manifest; fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-scheduler:)#    image: \1#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '^    image: registry.k8s.io/kube-scheduler:' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=controller-manager-command -->
#### Typo in the controller manager command (`controller-manager-command`)

The command in `/etc/kubernetes/manifests/kube-controller-manager.yaml` runs `kube-controller-managr`, which does not exist, so the controller manager never starts. The Deployment is scaled but no ReplicaSet creates Pods. Fix the binary name in the manifest.

```bash
sed -i -E 's#^([[:space:]]*)- kube-controller-managr$#\1- kube-controller-manager#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- kube-controller-manager$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```
<!-- /fault -->
