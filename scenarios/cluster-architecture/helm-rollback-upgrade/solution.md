## Solution

```bash
helm -n ${NS} list
helm -n ${NS} history ${REL}
# REVISION  STATUS      CHART         DESCRIPTION
# 1         superseded  webapp-1.0.0  Install complete
# 2         deployed    webapp-1.0.0  <description of the upgrade>

k -n ${NS} get pods                # the new Pod is not ready
helm -n ${NS} get values ${REL} --revision 1
helm -n ${NS} get values ${REL} --revision 2
```

<!-- fault BREAK=image-tag -->
Revision 2 ("Upgrade to the hardened image") set `image.tag: 1.26-alpinee`. That tag does not exist, so the new Pod sits in `ErrImagePull` / `ImagePullBackOff`. `k -n ${NS} describe pod <new pod>` shows the failed pull in its events.
<!-- /fault -->
<!-- fault BREAK=readiness-path -->
Revision 2 ("Use the health endpoint for readiness") set `readinessProbe.httpGet.path: /healthz`. nginx answers that path with 404, so the new Pod is Running but never `1/1` Ready. `k -n ${NS} describe pod <new pod>` shows `Readiness probe failed: HTTP probe failed with statuscode: 404`. The rolling update stalls because the old Pods are only removed once new ones are Ready.
<!-- /fault -->
<!-- fault BREAK=resources -->
Revision 2 ("Reserve capacity for peak load") set `resources.requests.cpu: 64`. No node has 64 CPUs, so the new Pod stays `Pending`. `k -n ${NS} describe pod <new pod>` shows `FailedScheduling ... Insufficient cpu`.
<!-- /fault -->

```bash
echo 2 > /opt/course/helm/broken-revision.txt
```

Helm reports revision 2 as `deployed`: an upgrade without `--wait` succeeds as soon as the objects are accepted. Check the Pods, not only the release status.

Roll back to revision 1. Helm records this as a new revision (3) with revision 1's configuration:

```bash
helm -n ${NS} rollback ${REL} 1
helm -n ${NS} history ${REL}      # 3  deployed  Rollback to 1
```

Now upgrade the chart and keep the current values (those of revision 1):

```bash
helm -n ${NS} upgrade ${REL} lab/webapp --version ${TARGET} --reuse-values
helm -n ${NS} get values ${REL}
# podAnnotations: { team: ${TEAM} }
# replicaCount: 2
k -n ${NS} get pods
```

Without `--reuse-values`, Helm uses only the chart defaults plus what you pass now, so the annotation would disappear (and with chart 1.1.0, `replicaCount` would drop to 1). Had you upgraded straight from revision 2 with `--reuse-values`, the broken value would have come along too.
