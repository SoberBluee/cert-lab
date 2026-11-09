## Solution

### Question 1: Bring ${Q1_PV} back into use

A `Released` volume keeps `spec.claimRef` pointing at the claim that is gone, including that claim's UID. A new claim with the same name is still a different object, so it stays `Pending` with `volume "${Q1_PV}" already bound to a different claim`. Remove the reference and the volume becomes `Available`. `Retain` means the data stays, and also that nothing makes the volume reusable for you.

```bash
kubectl patch pv "${Q1_PV}" --type=json -p '[{"op":"remove","path":"/spec/claimRef"}]'
```

Then create the claim, with `volumeName: ${Q1_PV}` so it cannot bind anywhere else, and the Pod.

### Question 2: Retire ${Q2_PVC} and keep its data

The StorageClass has `reclaimPolicy: Delete`, and each PV gets a copy of that value when it is created. Deleting the claim would delete the volume and its data. Change the policy on the **PV** first. Changing the StorageClass would not help: it only affects new volumes.

```bash
pv="$(kubectl -n "${Q2_NS}" get pvc "${Q2_PVC}" -o jsonpath='{.spec.volumeName}')"
kubectl patch pv "$pv" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
kubectl -n "${Q2_NS}" delete pod app
kubectl -n "${Q2_NS}" delete pvc "${Q2_PVC}"
kubectl get pv "$pv"
```
