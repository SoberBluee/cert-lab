## Solution

### Question 1: Service ${Q1_APP} unreachable

**The healthy setup**

- Deployment `${Q1_APP}`: `2` replicas of `nginx:1.27-alpine` labelled `app=${Q1_APP}`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `${Q1_APP}`: `ClusterIP`, selecting `app=${Q1_APP}`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `${Q1_NS}` from reaching `${Q1_APP}` on port `80`, and kube-proxy runs on every node
- `${Q1_APP}-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=listen-localhost -->
#### nginx listens on 127.0.0.1 only, and the probe asks localhost (`listen-localhost`)

The Service has 2 ready endpoints, yet connections are refused, and `wget http://<pod-ip>` from `${Q1_CLIENT}` is refused too. nginx listens on `127.0.0.1` only: ConfigMap `${Q1_APP}-nginx`, mounted over `/etc/nginx/conf.d`, says `listen 127.0.0.1:80`, and `kubectl -n ${Q1_NS} exec deploy/${Q1_APP} -- netstat -tln` shows it. The readiness probe hides this, because it runs `wget http://127.0.0.1/` inside the container. Change `listen` to `80` and restart the Pods, since nginx reads its configuration at start. Pointing the probe back at the `http` port makes it catch this next time.

```bash
kubectl -n "${Q1_NS}" get configmap "${Q1_APP}-nginx" -o yaml | sed 's/listen 127.0.0.1:80;/listen 80;/' | kubectl replace -f -
# The probe asks the Pod's own port again, so it notices if this ever comes back.
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe","value":{"httpGet":{"path":"/","port":"http"},"periodSeconds":5}}]'
# nginx reads its configuration when it starts.
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->
