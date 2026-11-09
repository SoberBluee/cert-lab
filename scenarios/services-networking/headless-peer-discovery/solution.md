## Solution

### Question 1: Return every Pod of ${Q1_APP} from DNS

A normal Service gets one virtual IP, and DNS returns that. Setting `clusterIP: None` makes it headless, so DNS returns the IP of each ready Pod. `spec.clusterIP` cannot change once set (`may not change once set`), so replace the Service.

```bash
kubectl -n "${Q1_NS}" delete service "${Q1_APP}"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
spec:
  clusterIP: None
  selector: { app: ${Q1_APP} }
  ports:
    - { port: 80 }
EOF
kubectl -n "${Q1_NS}" exec client -- nslookup ${Q1_APP}.${Q1_NS}.svc.cluster.local
```

Note that names like `${Q1_APP}-0.${Q1_APP}` already resolved before this change, because CoreDNS answers those per-Pod names for this Service either way. What headless changes is the answer for the Service's own name.

### Question 2: Members of ${Q2_APP} never become ready

This is a deadlock. A Pod's name is only published in DNS once the Pod is ready, and each Pod is only ready once it can resolve every member. Neither can go first.

`publishNotReadyAddresses: true` on the Service publishes the names of Pods that are not ready yet, which is what it exists for: letting members find each other during startup. The fix belongs on the Service, so the StatefulSet stays as it is.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" --type=merge -p '{"spec":{"publishNotReadyAddresses":true}}'
kubectl -n "${Q2_NS}" get pods
```
