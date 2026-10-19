Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Pod `${APP}` and client Pod `curlpod` run in namespace `${NS}`. Service `${APP}-svc` should make the app reachable as:

```bash
kubectl -n ${NS} exec curlpod -- wget -qO- -T 5 http://${APP}-svc
```

It does not work. Fix it.

You may delete and recreate Service `${APP}-svc`, but do not change its name, type, or port/`targetPort` (80).
