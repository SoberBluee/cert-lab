Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` in namespace `${NS}` should serve a static page on NodePort `${NODEPORT}`:

```bash
curl http://controlplane:${NODEPORT}/
```

It is not working. Troubleshoot and fix it so the page loads.
