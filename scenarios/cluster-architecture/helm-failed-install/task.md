Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Someone installed release `${REL}` from chart `lab/webapp` version `1.1.0` this morning. Repository `lab` is configured for user `ubuntu` on `controlplane`. The install failed, its Pods never became ready, and nobody remembers which namespace it went to.

1. Write the namespace of release `${REL}` to `/opt/course/helm/namespace.txt` on `controlplane`.
2. One value set at install time keeps the Pods from becoming ready. Write its name, as a Helm value path such as `service.type`, to `/opt/course/helm/bad-value.txt`.
3. Get release `${REL}` deployed with its 2 Pods ready. Fix the release in place: do not uninstall it, and keep the other values it was installed with.

Use Helm for every change.
