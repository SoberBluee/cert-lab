# PVC stays Pending

`VolumeMismatch`: PV is 100Mi, claim asks 150Mi. Delete and recreate the PVC with `storage: 100Mi` (and the same `volumeName`).
