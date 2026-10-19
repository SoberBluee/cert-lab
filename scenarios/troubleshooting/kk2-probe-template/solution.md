# Fix and apply a broken probe template

`kubectl apply -f /opt/course/${POD}.yaml` fails because `livenessProbe.httpGet` has `command` and no `port`. Change `httpGet` to `exec`. After apply, the Pod restarts: `initialDelaySeconds: 1` fires before `touch /healthcheck` (after 3s). Set `initialDelaySeconds` to at least `5`. Do not change `args`.

```bash
# edit /opt/course/${POD}.yaml then:
kubectl delete pod ${POD} --ignore-not-found
kubectl apply -f /opt/course/${POD}.yaml
```
