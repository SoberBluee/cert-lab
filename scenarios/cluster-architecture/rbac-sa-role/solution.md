## Solution

```bash
kubectl -n ${NS} create serviceaccount ${SA}
```

`kubectl create role` gives every listed resource the same verbs, so generate the YAML and add a second rule:

```bash
kubectl -n ${NS} create role ${SA}-role --verb=get,list,watch,create,update,delete \
  --resource=deployments.apps $do > role.yaml
vim role.yaml
```

```yaml
rules:
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "watch", "create", "update", "delete"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
```

```bash
kubectl apply -f role.yaml
kubectl -n ${NS} create rolebinding ${SA}-binding --role=${SA}-role --serviceaccount=${NS}:${SA}
```

Verify:

```bash
AS=system:serviceaccount:${NS}:${SA}
kubectl auth can-i create deployments -n ${NS} --as=$AS      # yes
kubectl auth can-i delete pods -n ${NS} --as=$AS             # no
kubectl auth can-i create deployments -n default --as=$AS    # no
```

`--serviceaccount` takes `<namespace>:<name>`. A ClusterRoleBinding would be wrong here: it grants the permissions in every namespace.
