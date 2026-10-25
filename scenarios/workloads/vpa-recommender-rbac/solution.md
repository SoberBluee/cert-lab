## Solution

### Question 1: VPA for processor not working

**The healthy setup**

- `processor-vpa` targets Deployment `processor` with update mode `Recreate` and manages container `web`
- the recommender, updater and admission controller run in namespace `vpa`, with their RBAC intact
- Pods the VPA changed carry its `vpaUpdates` annotation

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=recommender-rbac -->
#### Recommender cannot write VPA status (`recommender-rbac`)

The recommender runs and computes recommendations, but ClusterRoleBinding `vpa-status-actor` is gone, so it is forbidden to write them into VPA status (`kubectl -n vpa logs deploy/vpa-recommender` shows "forbidden ... verticalpodautoscalers/status"). Recreate the binding of ClusterRole `vpa-status-actor` to ServiceAccount `vpa:vpa-recommender`, then restart the Deployment once the recommendation appears.

```bash
kubectl create clusterrolebinding vpa-status-actor --clusterrole=vpa-status-actor --serviceaccount=vpa:vpa-recommender
kubectl -n vpa rollout restart deployment/vpa-recommender
kubectl -n vpa rollout status deployment/vpa-recommender --timeout=180s
for _ in $(seq 1 120); do
  kubectl -n "finops" get vpa "processor-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null | grep -q . && break
  sleep 2
done
kubectl -n "finops" rollout restart "deployment/processor"
```
<!-- /fault -->
