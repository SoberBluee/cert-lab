Use context: `kubectl config use-context kubernetes-admin@kubernetes`

During maintenance the CNI configuration was removed from one worker. That node is no longer healthy for Pod networking.

Restore the CNI so the node is `Ready` again and can run Pods. A backup of the CNI config files is on that worker under `/root/cni-backup`.
