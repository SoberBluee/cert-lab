## Solution

### Question 1: Deployment ${Q1_APP} will not stay scaled

**The healthy setup**

- `4` replicas of image `nginx:1.27-alpine`, with nothing else setting the replica count

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=hpa-pins-replicas -->
#### A HorizontalPodAutoscaler has a maximum of 1 (`hpa-pins-replicas`)

HorizontalPodAutoscaler `${Q1_APP}-capacity` has `maxReplicas: 1`, so within about 15 seconds of any scale-up it sets the Deployment back. `--show-managed-fields` shows `kube-controller-manager` writing `spec.replicas` through the `scale` subresource, and `kubectl -n ${Q1_NS} get hpa` shows the target. Delete it, or raise its limits so that 4 replicas fit, then scale the Deployment.

```bash
kubectl -n "${Q1_NS}" delete hpa "${Q1_APP}-capacity"
kubectl -n "${Q1_NS}" scale "deployment/${Q1_APP}" --replicas=4
printf '%s\n' "HorizontalPodAutoscaler/${Q1_APP}-capacity" > /opt/course/drift/${Q1_APP}.txt
```
<!-- /fault -->

<!-- fault Q1_FAULT=cronjob-reverts -->
#### A CronJob in another namespace scales the Deployment down (`cronjob-reverts`)

CronJob `capacity-guard` in namespace `cluster-tools` runs every minute and scales the Deployment to `1`. Nothing in `${Q1_NS}` shows it, apart from the binding that lets it in: `kubectl -n ${Q1_NS} get rolebindings -o wide` names ServiceAccount `cluster-tools/capacity-guard`. `--show-managed-fields` shows `kubectl` writing `spec.replicas` through the `scale` subresource, and `kubectl get cronjobs -A` finds the job. Delete it (or set `suspend: true`), let any running Job finish, then scale the Deployment.

```bash
kubectl -n cluster-tools delete cronjob capacity-guard
kubectl -n cluster-tools delete job --all --wait=true
kubectl -n "${Q1_NS}" scale "deployment/${Q1_APP}" --replicas=4
printf '%s\n' 'CronJob/capacity-guard' > /opt/course/drift/${Q1_APP}.txt
```
<!-- /fault -->
