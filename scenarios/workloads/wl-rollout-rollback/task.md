Use context: `kubectl config use-context kubernetes-admin@kubernetes`

A new release of Deployment `web` in namespace `prod` was just rolled out, and its new Pods never start.

Roll `web` back to the previous working revision so that all 3 replicas run again.

Do not delete or recreate the Deployment.
