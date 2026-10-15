Use context: `kubectl config use-context ${CTX}`

The security team needs a hardened backup workload with its own storage on a dedicated worker. Every namespaced resource of this task goes into namespace `${NS}`, which you have to create.

**Storage**

- Create a PersistentVolume `sec-pv`: capacity `3Gi`, access mode `ReadWriteOnce`, reclaim policy `Retain`, backed by the host directory `/mnt/sec-data` with hostPath type `DirectoryOrCreate`.
- The data only exists on `${NODE}`: the PV must only be usable on that node (required node affinity on `kubernetes.io/hostname`).
- Create a PersistentVolumeClaim `sec-pvc` requesting `2Gi` that binds to `sec-pv`.

**Workload**

Create a Pod `sec-vault` with one container using image `busybox:1.36`. The container runs

```
sh -c 'while true; do date >> /secure/vault/heartbeat; sleep 10; done'
```

and mounts `sec-pvc` at `/secure/vault`.

- Pod-level security context: `runAsNonRoot: true`, `runAsUser: ${RUN_UID}`, `fsGroup: ${FS_GID}`.
- Container-level security context: `readOnlyRootFilesystem: true`, and drop `ALL` capabilities.
- No container may override the Pod-level user settings, and the Pod must not run anything as root.

The task is complete when `sec-vault` is Running and a fresh `heartbeat` file owned by UID `${RUN_UID}` keeps appearing in `/mnt/sec-data` on `${NODE}`. Prepare whatever the node needs for that.
