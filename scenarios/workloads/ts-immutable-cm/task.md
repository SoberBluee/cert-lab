Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` in namespace `${NS}` was reconfigured and now serves the wrong page. Fix it so that both replicas are ready, `/` returns a page containing `${APP} is up`, and the containers can read the token from Secret `${APP}-secret` at `/etc/${APP}/token`.

Keep the image, keep serving the page from a ConfigMap and the token from Secret `${APP}-secret`, and do not change that Secret. Do not delete or recreate the Deployment.
