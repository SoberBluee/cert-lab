Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The Pod `db` in namespace `data` has been Pending since it was created. It should store its data on the existing PersistentVolume `data-pv`, which already holds data on `worker-1`.

Get `db` running with the PersistentVolumeClaim `db-data` bound to `data-pv` and mounted at `/data`.

- Do not delete, resize or otherwise modify `data-pv`.
- Keep the names `db` and `db-data`.
- The original Pod manifest is at `/opt/cka/db-pod.yaml` on `controlplane`.
