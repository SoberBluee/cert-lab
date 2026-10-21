Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Pod `client` in namespace `${NS}` can no longer reach Service `${APP}`:

```bash
kubectl -n ${NS} exec client -- wget -qO- -T 3 http://${APP}
```

Restore access, so that this returns the nginx welcome page again.

Do not delete or recreate Deployment `${APP}`, and keep its readiness probe. You may change or recreate Service `${APP}`, but it must stay a `ClusterIP` Service on port `80`.
