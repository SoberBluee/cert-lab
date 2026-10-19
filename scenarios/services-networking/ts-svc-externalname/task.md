Use context: `kubectl config use-context kubernetes-admin@kubernetes`

In namespace `${NS}`, Pod `client` can no longer reach Service `${APP}`:

```bash
kubectl -n ${NS} exec client -- wget -qO- -T 3 http://${APP}
```

Restore access. The intended setup is:

- Deployment `${APP}`: `2` replicas of `nginx:1.27-alpine` labelled `app=${APP}`, exposing container port `80` under the name `http`, with a readiness probe doing an HTTP GET of `/` on that port
- Service `${APP}`: `ClusterIP`, selecting `app=${APP}`, port `80` forwarding to the target port named `http`
- any Pod in the namespace may connect to `${APP}` on port `80`

Do not delete or recreate the Deployment. You may patch the Service (including its type) so it matches the spec again.
