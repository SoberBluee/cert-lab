## Solution

### Question 1: Read the API of a vendor CRD

`kubectl api-resources` lists every type the API server serves, with `SHORTNAMES`, `APIVERSION` (group and version), `NAMESPACED` and `KIND`.

```bash
kubectl api-resources | grep -E 'NAME|${Q1_KIND}'
kubectl api-resources --api-group=networking.k8s.io -o name | sed 's/\..*//' > /opt/course/api-resources/networking.txt
```

### Question 2: Find everything flagged in ${Q2_NS}

`kubectl get all -l audit=${Q2_FLAG}` finds nothing useful: `all` is a short list of common workload types, without ConfigMaps, ServiceAccounts, RBAC, NetworkPolicies or custom resources. Ask for every type that can be listed instead:

```bash
for type in $(kubectl api-resources --namespaced --verbs=list -o name); do
  kubectl -n "${Q2_NS}" get "$type" -l "audit=${Q2_FLAG}" -o name 2>/dev/null
done | sort -u > /opt/course/api-resources/flagged.txt
```

`--verbs=list` drops types that cannot be listed, which would only print errors. The same loop without `-l` is a quick way to see what is still in a namespace that refuses to terminate.
