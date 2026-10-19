# Immutable ConfigMap serves the wrong page

ConfigMap `${APP}-content` is `immutable: true` and serves the wrong `index.html`. Edits are rejected, and recreating it under the same name often leaves the kubelet serving the cached immutable object.

Create a new ConfigMap with the correct page, point the Deployment volume at it, then delete the old ConfigMap:

```bash
kubectl -n ${NS} create configmap ${APP}-content-fixed \
  --from-literal=index.html="<h1>${APP} is up</h1>"
kubectl -n ${NS} patch deployment ${APP} --type=json \
  -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"'"${APP}"'-content-fixed"}]'
```
