Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The cluster's Traefik controller serves Gateway API traffic through Gateway `traefik-gateway` in namespace `traefik`, on NodePort `30080` of every node.

The team behind `${APP}` in namespace `${NS}` published it with HTTPRoute `${APP}` for the host `${HOST}`, but

```
curl -H 'Host: ${HOST}' http://controlplane:30080/
```

returns `404 page not found`. They expect it to return the `${APP}` page.

Fix every problem in namespace `${NS}`.

Constraints:

- Do not modify Gateway `traefik-gateway` or anything else in namespace `traefik`.
- Do not modify Service `${APP}`.
- Keep the readiness probe of Deployment `${APP}`. Fix it if it is wrong; do not remove it.
