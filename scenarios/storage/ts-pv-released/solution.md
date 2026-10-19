# PVC stuck Pending against a Released PV

PersistentVolume `${CLAIM}-pv` is `Released` with reclaim policy `Retain` and still holds a `claimRef` to a deleted PVC. The new claim matches the volume but cannot bind until that `claimRef` is removed:

```bash
kubectl patch pv ${CLAIM}-pv --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
```

The claim then binds and `${CLAIM}-app` starts.
