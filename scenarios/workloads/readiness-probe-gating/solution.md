## Solution

### Question 1: Pods of ${Q1_APP} never become ready

The readiness probe asks port `80`, but nginx listens on `8080`, the port the container declares as `http`. `kubectl describe pod` shows `Readiness probe failed: ... connection refused`. An unready Pod is listed in the EndpointSlice as not ready and gets no traffic, so the Service has no working backend even though the Service itself is right. Point the probe at the real port, by name or as `8080`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}"
```

### Question 2: Take one Pod of ${Q2_APP} out of rotation

The file is the switch. While it is missing the probe passes; once it exists, `test` returns non-zero, and with `failureThreshold: 1` the next probe marks the Pod not ready. The Pod keeps running and nothing restarts, because only a liveness probe restarts a container. That is the difference to remember: readiness controls traffic, liveness controls restarts. Pick a Pod that is not `Terminating`: Pods of the old ReplicaSet can linger for a moment after the rollout finishes.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/readinessProbe","value":{"exec":{"command":["sh","-c","test ! -e /tmp/drain"]},"periodSeconds":2,"failureThreshold":1}}]'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}"
pod="$(kubectl -n "${Q2_NS}" get pods -l "app=${Q2_APP}" -o json | jq -r '[.items[] | select(.metadata.deletionTimestamp == null)][0].metadata.name')"
kubectl -n "${Q2_NS}" exec "$pod" -- touch /tmp/drain
kubectl -n "${Q2_NS}" get pods
```
