Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Pod `${CLAIM}-app` in namespace `${NS}` is Pending. It uses PersistentVolumeClaim `${CLAIM}`, which should bind to the existing PersistentVolume `${CLAIM}-pv`.

Get the claim bound to `${CLAIM}-pv` and `${CLAIM}-app` running with it. The Pod manifest is at `/opt/cka/${CLAIM}-app.yaml` on the control plane. Do not change the PersistentVolume.
