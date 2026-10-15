Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The platform team wants the agent from chart `lab/node-agent` on every node of the cluster. Repository `lab` is already configured for user `ubuntu` on `controlplane`.

1. Write the chart's **default** value of `interval`, for chart version `0.2.0`, to `/opt/course/helm/default-interval.txt`.
2. Without installing anything, render chart `lab/node-agent` version `0.2.0` with these values and save the manifests to `/opt/course/helm/node-agent.yaml`:
   - `logLevel`: `${LEVEL}`
   - `interval`: `${INTERVAL}`
   - tolerations so that the agent also runs on the control plane node
3. Install release `node-agent` from the same chart version with the same values into namespace `monitoring`, which does not exist yet. An agent Pod must run on all three nodes.
