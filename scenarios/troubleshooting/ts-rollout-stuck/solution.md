# Deployment rollout never finishes

The Deployment is paused (`spec.paused: true`) after a template change, and `maxSurge: 0` so the RollingUpdate cannot surge ahead. Existing Pods look fine, but `updatedReplicas` never catches up.

Unpause, restore a normal surge/unavailable, and let the rollout finish:

```bash
kubectl -n ${NS} patch deployment ${APP} --type=strategic \
  -p '{"spec":{"paused":false,"strategy":{"rollingUpdate":{"maxSurge":"25%","maxUnavailable":"25%"}}}}'
kubectl -n ${NS} rollout status deployment/${APP}
```
