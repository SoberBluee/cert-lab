## Solution

### Question 1: Expose Pod ${Q1_POD}

`kubectl expose pod` builds the Service's selector from the Pod's labels. This Pod has none, so it fails with "couldn't retrieve selectors via --selector flag or introspection". Labels can be added to a running Pod without restarting it, so add one and expose it.

```bash
kubectl -n "${Q1_NS}" label pod "${Q1_POD}" "app=${Q1_POD}"
kubectl -n "${Q1_NS}" expose pod "${Q1_POD}" --port="${Q1_PORT}" --target-port=80
```

### Question 2: Expose both ports of ${Q2_APP}

`kubectl expose` can write the Service, but it cannot set names, a nodePort and named targets in one go, so write the manifest (or edit the output of `--dry-run=client -o yaml`). A Service with more than one port must name each port. `targetPort` takes the name of a container port, which is resolved per Pod.

```bash
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
spec:
  type: NodePort
  selector: { app: ${Q2_APP} }
  ports:
    - { name: web, port: 80, targetPort: http, nodePort: ${Q2_NODEPORT} }
    - { name: metrics, port: 9100, targetPort: metrics }
EOF
```
