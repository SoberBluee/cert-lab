# NodePort site is down

`FailedMount` on the volume: Deployment references ConfigMap `${APP}-configuration`, but the real one is `${APP}-config`. Patch or edit the Deployment volume name, then `curl http://controlplane:${NODEPORT}/`.
