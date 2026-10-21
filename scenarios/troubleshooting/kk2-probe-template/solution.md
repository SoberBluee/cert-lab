# Fix and apply a broken probe template

`kubectl apply -f /opt/course/${POD}.yaml` fails because `livenessProbe.httpGet` has `command` and no `port`. Change `httpGet` to `exec`. After apply, the Pod restarts within seconds and soon shows `CrashLoopBackOff`: with `initialDelaySeconds: 1` and `periodSeconds: 1` the probe runs before `touch /healthcheck` (after 3s), and `failureThreshold: 1` restarts the container on the first failure. Set `initialDelaySeconds` to at least `5`, so the probe starts after the file exists. Do not change `args`.

```bash
# edit /opt/course/${POD}.yaml then:
kubectl delete pod ${POD} --ignore-not-found
kubectl apply -f /opt/course/${POD}.yaml
```
