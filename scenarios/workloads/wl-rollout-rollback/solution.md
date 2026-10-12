## Solution

The new revision points at an image tag that does not exist:

```bash
kubectl -n prod get pods                      # one Pod in ErrImagePull / ImagePullBackOff
kubectl -n prod describe pod <that pod>       # Failed to pull image "nginx:1.27-alpine-build42"
kubectl -n prod rollout history deployment web
```

The old ReplicaSet keeps the remaining Pods running while the rollout is stuck. Roll back:

```bash
kubectl -n prod rollout undo deployment web
kubectl -n prod rollout status deployment web
kubectl -n prod get deployment web -o jsonpath='{.spec.template.spec.containers[0].image}'   # nginx:1.27-alpine
```

`kubectl -n prod set image deployment/web nginx=nginx:1.27-alpine` reaches the same end state.
