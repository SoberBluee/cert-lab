Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The team keeps its charts in a Helm repository at `http://controlplane:8879`. Work on `controlplane` as user `ubuntu`.

1. Add the repository under the name `lab`.
2. Write every available version of the chart `webapp` in that repository to `/opt/course/helm/versions.txt`.
3. Install release `${REL}` from chart `lab/webapp` at version `1.1.0` into namespace `${NS}`, which does not exist yet. Using Helm values (not `kubectl` edits afterwards):
   - run `${REPLICAS}` replicas
   - expose it through a Service of type `NodePort`
