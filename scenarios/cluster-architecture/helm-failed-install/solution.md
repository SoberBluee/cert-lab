## Solution

`helm list` only shows the current namespace. `-A` shows every namespace, and failed releases are listed too:

```bash
helm list -A
# NAME      NAMESPACE   REVISION  STATUS    CHART
# docs      docs-site   1         deployed  webapp-1.0.0
# frontend  web-shared  1         deployed  webapp-1.1.0
# ${REL}    ${NS}       1         failed    webapp-1.1.0

echo ${NS} > /opt/course/helm/namespace.txt
```

Compare what the install set with what its Pods do:

```bash
helm -n ${NS} get values ${REL}
k -n ${NS} get pods
k -n ${NS} describe pod <pod>
```

<!-- fault BREAK=image-tag -->
The install set `image.tag: 1.27-alpinee`. That tag does not exist, so the Pods sit in `ErrImagePull` / `ImagePullBackOff`, and `describe pod` shows the failed pull.

```bash
echo image.tag > /opt/course/helm/bad-value.txt
helm -n ${NS} upgrade ${REL} lab/webapp --version 1.1.0 --reuse-values --set image.tag=1.27-alpine
```

Removing the tag with `--set image.tag=null` works too: the chart then uses its appVersion, `1.27-alpine`.
<!-- /fault -->
<!-- fault BREAK=node-selector -->
The install set `nodeSelector.disktype: nvme`. No node carries that label, so the Pods stay `Pending`, and `describe pod` shows `FailedScheduling ... didn't match Pod's node affinity/selector`.

```bash
echo nodeSelector > /opt/course/helm/bad-value.txt
helm -n ${NS} upgrade ${REL} lab/webapp --version 1.1.0 --reuse-values --set nodeSelector.disktype=null
```
<!-- /fault -->
<!-- fault BREAK=cpu-request -->
The install set `resources.requests.cpu: 64`. No node has 64 CPUs, so the Pods stay `Pending`, and `describe pod` shows `FailedScheduling ... Insufficient cpu`.

```bash
echo resources.requests.cpu > /opt/course/helm/bad-value.txt
helm -n ${NS} upgrade ${REL} lab/webapp --version 1.1.0 --reuse-values --set resources.requests.cpu=null
```
<!-- /fault -->

There is no good revision to roll back to: revision 1 is the failed install. `helm upgrade` still works on such a release, and creates revision 2.

`--reuse-values` keeps every value of the failed revision, the bad one included, so override or remove it in the same command. `--set <key>=null` deletes a value. Without `--reuse-values`, the upgrade would drop `replicaCount` and the owner annotation instead.

```bash
helm -n ${NS} history ${REL}
# 1  failed    webapp-1.1.0  Release "${REL}" failed: context deadline exceeded
# 2  deployed  webapp-1.1.0  Upgrade complete
k -n ${NS} get pods
```

Uninstalling and installing again would also give working Pods, but it throws away the release's history, which the task asks you to keep.
