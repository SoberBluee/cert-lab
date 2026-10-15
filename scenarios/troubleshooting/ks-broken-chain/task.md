Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The storefront in namespace `${NS}` is down. Users reach it through the NodePort Service `${APP}-web` on port `${NODEPORT}` of any node. `${APP}-web` proxies every request to the Service `${APP}-api`, whose Pods answer with `api ok: <token>`, reading the token from Secret `${APP}-api-creds`.

There is more than one problem along the way. Fix all of them so that

```
curl http://controlplane:${NODEPORT}/
```

returns the API payload with the token.

Constraints:

- Do not delete or recreate NetworkPolicy `${APP}-web-egress`. `${APP}-web` may only talk to `${APP}-api` and to cluster DNS. It must still be blocked from reaching `${APP}-admin`.
- Do not modify Secret `${APP}-api-creds`.

Then write each root cause you fixed to `/opt/course/chain/causes.txt` on `controlplane`: one line per cause, naming the resource and the field that was wrong (for example `configmap/foo: key index.html is missing`). The file must contain exactly one line per cause.
