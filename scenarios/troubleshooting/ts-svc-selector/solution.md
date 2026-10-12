## Solution

There are two problems: the selector matches no Pods, and the `targetPort` is wrong.

```bash
kubectl -n ${NS} get pods --show-labels         # app=${APP},tier=backend
kubectl -n ${NS} describe svc ${APP}-svc        # Selector: app=${APP}-server,tier=backend   Endpoints: <none>
```

Fix the selector, then look again:

```bash
kubectl -n ${NS} edit svc ${APP}-svc
#   selector:
#     app: ${APP}
#     tier: backend
kubectl -n ${NS} get endpointslices             # now lists 2 addresses, port 8080
```

nginx listens on port 80, not 8080:

```bash
kubectl -n ${NS} get deploy ${APP} -o jsonpath='{.spec.template.spec.containers[0].ports}'
kubectl -n ${NS} edit svc ${APP}-svc
#   ports:
#   - port: ${PORT}
#     targetPort: 80
```

Test it from a temporary Pod:

```bash
kubectl -n ${NS} run tmp --rm -it --restart=Never --image=busybox:1.36 -- wget -qO- -T 3 http://${APP}-svc:${PORT}
```
