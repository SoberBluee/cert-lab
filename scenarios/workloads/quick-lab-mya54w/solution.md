## Solution

### Question 1: VPA for ${Q1_APP} not working

**The healthy setup**

- `${Q1_APP}-vpa` targets Deployment `${Q1_APP}` with update mode `Recreate` and manages container `web`
- the recommender, updater and admission controller run in namespace `vpa`, with their RBAC intact
- Pods the VPA changed carry its `vpaUpdates` annotation

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=recommender-down -->
#### VPA recommender scaled to zero (`recommender-down`)

The `vpa/vpa-recommender` Deployment has `0` replicas, so nothing computes recommendations and `${Q1_APP}-vpa` has no Recommendation in its status. Scale the recommender back to `1`, wait for the recommendation (about a minute), then `kubectl -n ${Q1_NS} rollout restart deployment ${Q1_APP}` so new Pods get it.

```bash
kubectl -n vpa scale "deployment/vpa-recommender" --replicas=1
kubectl -n vpa rollout status "deployment/vpa-recommender" --timeout=180s
for _ in $(seq 1 120); do
  kubectl -n "${Q1_NS}" get vpa "${Q1_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=admission-down -->
#### VPA admission controller scaled to zero (`admission-down`)

`${Q1_APP}-vpa` has a recommendation, but the `vpa/vpa-admission-controller` Deployment has `0` replicas. Its webhook fails open (failurePolicy Ignore), so Pods are created unchanged, and the updater stops evicting while the admission controller is missing. Scale it back to `1`, then `kubectl -n ${Q1_NS} rollout restart deployment ${Q1_APP}`.

```bash
kubectl -n vpa scale "deployment/vpa-admission-controller" --replicas=1
kubectl -n vpa rollout status "deployment/vpa-admission-controller" --timeout=180s
for _ in $(seq 1 120); do
  kubectl -n "${Q1_NS}" get vpa "${Q1_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=target-name -->
#### VPA targets a missing Deployment (`target-name`)

`spec.targetRef.name` is `${Q1_APP}-v1`, which does not exist, so the VPA matches no Pods and never recommends anything (`kubectl describe vpa` shows a ConfigUnsupported condition). Point it at Deployment `${Q1_APP}`, wait for the recommendation, then restart the Deployment.

```bash
kubectl -n "${Q1_NS}" patch vpa "${Q1_APP}-vpa" --type=merge -p '{"spec":{"targetRef":{"name":"'"${Q1_APP}"'"}}}'
for _ in $(seq 1 120); do
  kubectl -n "${Q1_NS}" get vpa "${Q1_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=mode-off -->
#### Update mode is Off (`mode-off`)

`${Q1_APP}-vpa` recommends resources but its update mode is `Off`: the VPA only reports and never changes Pods. Set `updatePolicy.updateMode` to `Recreate`, then restart the Deployment so the admission controller sets the requests.

```bash
kubectl -n "${Q1_NS}" patch vpa "${Q1_APP}-vpa" --type=merge -p '{"spec":{"updatePolicy":{"updateMode":"Recreate"}}}'
for _ in $(seq 1 120); do
  kubectl -n "${Q1_NS}" get vpa "${Q1_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=container-off -->
#### Container policy excludes web (`container-off`)

A container policy sets `mode: "Off"` for `web`, the only container, so the VPA neither recommends nor changes anything for it. Remove the policy (or set its mode to `Auto`), then restart the Deployment.

```bash
kubectl -n "${Q1_NS}" patch vpa "${Q1_APP}-vpa" --type=json -p '[{"op":"remove","path":"/spec/resourcePolicy"}]'
for _ in $(seq 1 120); do
  kubectl -n "${Q1_NS}" get vpa "${Q1_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->

<!-- fault Q1_FAULT=recommender-rbac -->
#### Recommender cannot write VPA status (`recommender-rbac`)

The recommender runs and computes recommendations, but ClusterRoleBinding `vpa-status-actor` is gone, so it is forbidden to write them into VPA status (`kubectl -n vpa logs deploy/vpa-recommender` shows "forbidden ... verticalpodautoscalers/status"). Recreate the binding of ClusterRole `vpa-status-actor` to ServiceAccount `vpa:vpa-recommender`, then restart the Deployment once the recommendation appears.

```bash
kubectl create clusterrolebinding vpa-status-actor --clusterrole=vpa-status-actor --serviceaccount=vpa:vpa-recommender
kubectl -n vpa rollout restart deployment/vpa-recommender
kubectl -n vpa rollout status deployment/vpa-recommender --timeout=180s
for _ in $(seq 1 120); do
  kubectl -n "${Q1_NS}" get vpa "${Q1_APP}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->
