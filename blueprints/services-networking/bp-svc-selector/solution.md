## Solution

```bash
kubectl -n ${NS} describe svc ${APP}            # Selector: app=${APP}${WRONG}   Endpoints: <none>
kubectl -n ${NS} get pods --show-labels         # app=${APP}
kubectl -n ${NS} edit svc ${APP}                # selector: app: ${APP}
kubectl -n ${NS} get endpointslices             # 2 addresses
```
