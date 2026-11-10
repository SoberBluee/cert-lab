Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The team wants its own variant of chart `lab/webapp` version `2.0.0`, with different defaults, installed from a package file rather than from the repository. Repository `lab` is configured for user `ubuntu`. Work as `ubuntu` on `controlplane`.

1. Download chart `lab/webapp` version `2.0.0` and unpack it into `/opt/course/helm/charts`, so that its `Chart.yaml` is at `/opt/course/helm/charts/webapp/Chart.yaml`.
2. Change the unpacked chart so that, by default, it runs `${REPLICAS}` replicas behind a Service of type `NodePort`. Its own chart version becomes `2.0.1`.
3. Package it to `/opt/course/helm/webapp-2.0.1.tgz`.
4. Install release `${REL}` from that package file into namespace `${NS}`, which does not exist yet. Pass no values: the chart's new defaults do the work.
