# Node drain is stuck

PodDisruptionBudget `${APP}-pdb` sets `minAvailable: 2` while the Deployment also has 2 replicas, so every eviction is denied and `kubectl drain` hangs. The Pods are also pinned to `${NODE}` with `nodeSelector: drain-lab=yes`.

Lower `minAvailable` (or delete the PDB), remove the nodeSelector so replicas can schedule elsewhere, then drain `${NODE}`:

```bash
kubectl -n ${NS} patch pdb ${APP}-pdb --type=merge -p '{"spec":{"minAvailable":0}}'
kubectl -n ${NS} patch deployment ${APP} --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
kubectl drain ${NODE} --ignore-daemonsets --delete-emptydir-data
```
