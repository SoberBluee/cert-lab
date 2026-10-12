## Solution

```bash
kubectl -n ${NS} describe pvc ${CLAIM}           # storageclass "${WRONG_CLASS}" not found
kubectl get pv ${CLAIM}-pv                        # STORAGECLASS manual, Available
kubectl -n ${NS} get pvc ${CLAIM} -o yaml > pvc.yaml
vim pvc.yaml                                      # storageClassName: manual; drop status and uid
kubectl -n ${NS} delete pod ${CLAIM}-app
kubectl -n ${NS} delete pvc ${CLAIM}
kubectl apply -f pvc.yaml
kubectl apply -f /opt/cka/${CLAIM}-app.yaml
kubectl -n ${NS} get pvc,pod                      # Bound, Running
```
