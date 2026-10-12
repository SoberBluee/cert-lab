## Solution

```bash
kubectl -n analytics describe pod -l app=reports | grep -A3 Events
# 0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: },
# 1 node(s) didn't match Pod's node affinity/selector, 1 node(s) had untolerated taint {dedicated: analytics}
```

There are two blockers:

1. The Pods select `disktype=ssd`, but no node has that label.
2. `worker-2` has the taint `dedicated=analytics:NoSchedule`, and the Pods do not tolerate it.

```bash
kubectl label node worker-2 disktype=ssd

kubectl -n analytics edit deployment reports
```

```yaml
    spec:
      nodeSelector:
        disktype: ssd
      tolerations:
        - key: dedicated
          operator: Equal
          value: analytics
          effect: NoSchedule
```

```bash
kubectl -n analytics get pods -o wide
```

A toleration only *allows* scheduling onto the tainted node. The label and nodeSelector are what *force* the Pods there. You need both.
