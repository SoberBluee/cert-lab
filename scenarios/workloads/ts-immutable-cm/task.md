Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` in namespace `${NS}` was just reconfigured and is no longer healthy. Fix it so that it matches this spec and both Pods are ready:

- `2` replicas of image `nginx:1.27-alpine`, container `web` serving on port `80`, with a readiness probe doing an HTTP GET of `/`
- a ConfigMap providing `index.html` mounted at `/usr/share/nginx/html` (the broken one is `${APP}-content`)
- key `token` of Secret `${APP}-secret`, mounted as the file `/etc/${APP}/token`

Do not delete or recreate the Deployment. Prefer fixing mounts and securityContext on the Pod template; replace the ConfigMap or Secret only if they cannot be patched (for example when marked immutable). You may create a replacement ConfigMap and point the volume at it.
