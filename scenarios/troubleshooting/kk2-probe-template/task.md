Use context: `kubectl config use-context kubernetes-admin@kubernetes`

A Pod template is stored at `/opt/course/${POD}.yaml` on `controlplane`. Applying it as-is fails.

Fix the template and create the Pod. Watch it for a minute so it stays stable (no CrashLoop / rising restart count).

Do **not** change the `args:` section of the template.
