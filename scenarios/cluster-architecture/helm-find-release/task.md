Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Several teams run chart `lab/webapp` with Helm in this cluster. Repository `lab` is configured for user `ubuntu` on `controlplane`. One release was installed from chart version `1.0.0` but runs image `nginx:1.28-alpine`, because its team overrode the image tag.

1. Find that release, and write it as `<namespace>/<release>` to `/opt/course/helm/release.txt` on `controlplane`.
2. Write the values its team set for it, as Helm reports them, to `/opt/course/helm/values.yaml`.
3. Scale the release to `${REPLICAS}` replicas with Helm. Keep every value its team set, and keep it on chart version `1.0.0`.
