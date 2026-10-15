Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The team manages its applications in namespace `${NS}` with Helm, from repository `lab` (already configured for user `ubuntu`). Tidy up:

1. Delete release `${OLD}`.
2. Upgrade release `${UPG}` to the newest version of chart `lab/webapp`.
3. Install a new release `${NEW}` from chart `lab/webapp` at version `1.0.0`, running `2` replicas, set through Helm values.
4. Some releases in `${NS}` are stuck: their last install or upgrade never completed successfully. Find them and delete them.

Do not touch releases in other namespaces.
