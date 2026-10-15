## Solution

Start from the question the API server answers, then follow the chain:

```bash
k auth can-i list pods -A --as=system:serviceaccount:${NS}:${SA}     # no
k get clusterrolebinding ${SA}-read -o yaml
k get clusterrole ${SA}-read -o yaml
k -n ${NS} get deploy,rs,pods,sa
```

### The binding's subject

<!-- fault BINDING_FAULT=subject-namespace -->
The subject is ServiceAccount `${SA}` in namespace `default`, a different identity from `${NS}/${SA}`. Set `namespace: ${NS}`.
<!-- /fault -->
<!-- fault BINDING_FAULT=subject-name -->
The subject is ServiceAccount `${SA}-sa`, which does not exist. Set `name: ${SA}`.
<!-- /fault -->
<!-- fault BINDING_FAULT=subject-kind -->
The subject is a **User** called `${SA}`. A ServiceAccount authenticates as `system:serviceaccount:${NS}:${SA}`, so it never matches. Make it `kind: ServiceAccount`, `name: ${SA}`, `namespace: ${NS}` (and drop `apiGroup`).
<!-- /fault -->

Subjects can be edited in place (`roleRef` cannot):

```bash
k edit clusterrolebinding ${SA}-read
# subjects:
# - kind: ServiceAccount
#   name: ${SA}
#   namespace: ${NS}
```

### The ClusterRole's rule

<!-- fault ROLE_FAULT=verbs -->
`verbs: [get, watch]`. `get` reads one named object; `kubectl get pods` and every informer need `list`. Use `[get, list, watch]`.
<!-- /fault -->
<!-- fault ROLE_FAULT=resource -->
`resources: [pod]`. RBAC compares the **plural** resource name literally (`kubectl api-resources` shows `pods`), so the rule matches nothing. Use `pods`.
<!-- /fault -->
<!-- fault ROLE_FAULT=api-group -->
`apiGroups: [apps]`. Pods are in the core group, written as `""`. Use `apiGroups: [""]`.
<!-- /fault -->

Do not use `*` anywhere: that would allow writes too.

### The Deployment's ServiceAccount

<!-- fault WORKLOAD_FAULT=no-sa -->
`spec.template.spec.serviceAccountName` is empty, so the Pods run as `default`:

```bash
k -n ${NS} set serviceaccount deployment ${SA} ${SA}
```
<!-- /fault -->
<!-- fault WORKLOAD_FAULT=sa-typo -->
The Deployment has no Pods. `k -n ${NS} describe rs` shows `error looking up service account ${NS}/${SA}-sa: serviceaccount "${SA}-sa" not found`. Point it at the real one:

```bash
k -n ${NS} set serviceaccount deployment ${SA} ${SA}
```
<!-- /fault -->
<!-- fault WORKLOAD_FAULT=sa-missing -->
The Deployment has no Pods. `k -n ${NS} describe rs` shows `serviceaccount "${SA}" not found`: the Deployment is right, but the ServiceAccount itself was never created.

```bash
k -n ${NS} create serviceaccount ${SA}
```
<!-- /fault -->

```bash
k -n ${NS} rollout status deployment ${SA}
```

### Record the result

```bash
k auth can-i list pods -A --as=system:serviceaccount:${NS}:${SA} > /opt/course/6/can-i.txt
cat /opt/course/6/can-i.txt    # yes
k auth can-i create pods -A --as=system:serviceaccount:${NS}:${SA}     # no
```
