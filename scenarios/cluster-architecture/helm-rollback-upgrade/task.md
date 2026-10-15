Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Release `${REL}` in namespace `${NS}` comes from chart `webapp` in the Helm repository `lab` (already configured for user `ubuntu`). Someone upgraded it earlier today, and since then the new Pods never become ready.

1. Find the broken revision and write its number to `/opt/course/helm/broken-revision.txt` on `controlplane`.
2. Roll the release back to the last revision that worked.
3. Then upgrade the release to chart version `${TARGET}`, keeping every value the release was originally installed with.

Use Helm for every change. Do not edit the Deployment with `kubectl`.
