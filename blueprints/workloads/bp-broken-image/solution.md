## Solution

```bash
kubectl -n ${NS} get pods                                # new Pods in ImagePullBackOff
kubectl -n ${NS} describe pod <new-pod> | tail           # manifest for nginx:${BAD_TAG} not found
kubectl -n ${NS} rollout undo deployment ${DEPLOY}
kubectl -n ${NS} rollout status deployment ${DEPLOY}
```

`kubectl -n ${NS} set image deployment/${DEPLOY} nginx=nginx:1.27-alpine` works too.
