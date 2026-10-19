Use context: `kubectl config use-context kubernetes-admin@kubernetes`

PersistentVolume `${NAME}-pv` exists. PersistentVolumeClaim `${NAME}-pvc` in namespace `${NS}` should bind to it, but the claim stays `Pending`. There is no data in the volume yet.

Fix the claim so it becomes `Bound` to `${NAME}-pv`. Do not change the PV capacity.
