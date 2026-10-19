Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Namespace `${NS}` has Deployment/Service `${APP}` and Ingress `${APP}` (host `${APP}.${NS}.lab`). Traefik serves Ingress and Gateway API traffic on NodePort `30080`.

1. Create HTTPRoute `${APP}-route` in `${NS}` that attaches to Gateway `traefik-gateway` in namespace `traefik` (listener `web`) and routes that host to Service `${APP}` on port `80`.
2. Delete Ingress `${APP}`.
3. Confirm:

```bash
curl -H 'Host: ${APP}.${NS}.lab' http://controlplane:30080/
```

returns the app page.
