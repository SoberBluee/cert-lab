Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Node `worker-1` is in status `NotReady`. Workloads can no longer be scheduled onto it.

Find the cause and fix it so that:

- `worker-1` is `Ready` again
- the fix survives a reboot of `worker-1`

You can reach the node with `ssh worker-1` from the control plane, or use the ssh command for `worker-1` in the connection panel.
