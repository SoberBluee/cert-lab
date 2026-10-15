## Solution

```bash
kubectl -n ${NS} create sa ${SA}
kubectl -n ${NS} create role ${SA}-role --verb=get,list,watch,create,update,patch --resource=deployments.apps
kubectl -n ${NS} edit role ${SA}-role     # add: {apiGroups: [""], resources: [pods], verbs: [get, list]}
kubectl -n ${NS} create rolebinding ${SA}-role --role=${SA}-role --serviceaccount=${NS}:${SA}
kubectl create clusterrole ${SA}-cluster --verb=get,list --resource=${CLUSTER_RES}
kubectl create clusterrolebinding ${SA}-cluster --clusterrole=${SA}-cluster --serviceaccount=${NS}:${SA}
kubectl -n ${NS} create deployment ${SA}-probe --image=nginx:1.27-alpine $do > probe.yaml
# add spec.template.spec.serviceAccountName: ${SA}, then kubectl apply -f probe.yaml
```

Do not bind the Deployment rights with a ClusterRoleBinding: that would grant them in every namespace.
