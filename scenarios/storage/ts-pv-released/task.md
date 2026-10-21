Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Pod `${CLAIM}-app` in namespace `${NS}` has been `Pending` since it was created. Get it `Running` with claim `${CLAIM}` mounted at `/data`.

Its data lives on PersistentVolume `${CLAIM}-pv`: do not delete that volume or change its capacity, class or access modes. You may delete and re-create the claim and the Pod, keeping their names and the Pod's image and command.
