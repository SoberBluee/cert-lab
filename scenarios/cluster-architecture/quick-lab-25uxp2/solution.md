## Solution

### Question 1: Hardening review of ${Q1_NS}-apps

```bash
kubectl -n ${Q1_NS}-apps get pods -o json | jq -r '.items[] | select([((.spec.initContainers // []) + .spec.containers)[] | .securityContext.privileged // false] | any) | .metadata.name' > /opt/course/audit/privileged.txt
kubectl -n ${Q1_NS}-apps get pods -o json | jq -r '.items[] | select(.spec.hostNetwork == true) | .metadata.name' > /opt/course/audit/host-network.txt
kubectl -n ${Q1_NS}-apps get pods -o json | jq -r '.items[] | select([.spec.volumes[]? | has("hostPath")] | any) | .metadata.name' > /opt/course/audit/host-path.txt
```
