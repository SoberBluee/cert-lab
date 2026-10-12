## Solution

```bash
kubectl -n ${NS} create serviceaccount ${SA}
kubectl -n ${NS} create role ${SA}-role --verb=get,list,watch --resource=${RESOURCE}
kubectl -n ${NS} create rolebinding ${SA}-binding --role=${SA}-role --serviceaccount=${NS}:${SA}
kubectl auth can-i list ${RESOURCE} -n ${NS} --as=system:serviceaccount:${NS}:${SA}     # yes
kubectl auth can-i delete ${RESOURCE} -n ${NS} --as=system:serviceaccount:${NS}:${SA}   # no
```

A ClusterRole with a ClusterRoleBinding would be wrong: the permissions would apply in every namespace.
