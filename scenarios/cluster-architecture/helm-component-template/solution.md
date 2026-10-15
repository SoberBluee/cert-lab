## Solution

### 1. The default value

```bash
helm show values lab/node-agent --version 0.2.0
# interval: 30
# logLevel: info
# tolerations: []
echo 30 > /opt/course/helm/default-interval.txt
```

### 2. Render without installing

Tolerations are a list, so a values file is easier than `--set 'tolerations[0].key=...'`:

```bash
cat > values.yaml <<EOF
logLevel: ${LEVEL}
interval: ${INTERVAL}
tolerations:
  - key: node-role.kubernetes.io/control-plane
    operator: Exists
    effect: NoSchedule
EOF

helm template node-agent lab/node-agent --version 0.2.0 -f values.yaml > /opt/course/helm/node-agent.yaml
grep -nE 'kind:|level=|tolerations' -A2 /opt/course/helm/node-agent.yaml
```

`helm template` only renders. Nothing reaches the cluster and no release is recorded, which makes it the safe way to review a chart, or to apply its manifests with `kubectl` when Helm itself is not wanted on the cluster.

### 3. Install

```bash
helm install node-agent lab/node-agent --version 0.2.0 -n monitoring --create-namespace -f values.yaml
k -n monitoring get ds node-agent        # DESIRED 3  READY 3
k -n monitoring get pods -o wide         # one per node, including controlplane
```

Without the toleration, the DaemonSet only schedules 2 Pods, because the control plane's `NoSchedule` taint keeps the agent off `controlplane`.
