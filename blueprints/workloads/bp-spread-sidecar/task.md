Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Create a Deployment `${DEPLOY}` in namespace `${NS}` with `3` replicas and Pod label `app=${DEPLOY}`:

- Init container `seed` (`busybox:1.36`) writes `<h1>${DEPLOY}</h1>` to `index.html` in a shared `emptyDir` volume.
- Container `web` (`nginx:1.27-alpine`) serves that volume from `/usr/share/nginx/html`, and writes its logs as files to `/var/log/nginx` on a second `emptyDir`.
- Sidecar container `log-tail` (`${SIDECAR_IMAGE}`) follows `/var/log/nginx/access.log`, so that `kubectl logs ... -c log-tail` shows every request.
- No two Pods of `${DEPLOY}` may ever run on the same node (a required rule).

Keep 3 replicas. Write the scheduler's reason why the remaining Pod cannot run to `/opt/course/pending-reason.txt` on `controlplane`.
