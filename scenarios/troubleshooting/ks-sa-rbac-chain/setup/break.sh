#!/usr/bin/env bash
# Three links of the chain broken, one fault each: the ClusterRole's rule ($ROLE_FAULT), the
# binding's subject ($BINDING_FAULT) and the Deployment's ServiceAccount ($WORKLOAD_FAULT).
set -euo pipefail

kubectl delete namespace "$NS" --ignore-not-found --wait=true >/dev/null
kubectl delete clusterrole "${SA}-read" --ignore-not-found >/dev/null
kubectl delete clusterrolebinding "${SA}-read" --ignore-not-found >/dev/null
kubectl create namespace "$NS" >/dev/null
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
mkdir -p /opt/course/6
rm -f /opt/course/6/can-i.txt
chown -R ubuntu:ubuntu /opt/course

group='""'; resource=pods; verbs="get, list, watch"
case "$ROLE_FAULT" in
  verbs) verbs="get, watch" ;;
  resource) resource=pod ;;
  api-group) group=apps ;;
  *) echo "unknown ROLE_FAULT $ROLE_FAULT" >&2; exit 1 ;;
esac

subject="{ kind: ServiceAccount, name: ${SA}, namespace: ${NS} }"
case "$BINDING_FAULT" in
  subject-namespace) subject="{ kind: ServiceAccount, name: ${SA}, namespace: default }" ;;
  subject-name) subject="{ kind: ServiceAccount, name: ${SA}-sa, namespace: ${NS} }" ;;
  subject-kind) subject="{ kind: User, apiGroup: rbac.authorization.k8s.io, name: ${SA} }" ;;
  *) echo "unknown BINDING_FAULT $BINDING_FAULT" >&2; exit 1 ;;
esac

sa_object="apiVersion: v1
kind: ServiceAccount
metadata: { name: ${SA}, namespace: ${NS} }
---"
pod_sa="serviceAccountName: ${SA}"
case "$WORKLOAD_FAULT" in
  no-sa) pod_sa="" ;;
  sa-typo) pod_sa="serviceAccountName: ${SA}-sa" ;;
  sa-missing) sa_object="" ;;
  *) echo "unknown WORKLOAD_FAULT $WORKLOAD_FAULT" >&2; exit 1 ;;
esac

kubectl apply -f - <<EOF
${sa_object}
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: ${SA}-read }
rules:
  - apiGroups: [${group}]
    resources: [${resource}]
    verbs: [${verbs}]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: ${SA}-read }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: ${SA}-read }
subjects:
  - ${subject}
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${SA}, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: ${SA} } }
  template:
    metadata: { labels: { app: ${SA} } }
    spec:
      ${pod_sa}
      containers:
        - name: reporter
          image: busybox:1.36
          command: [sh, -c, "sleep 1d"]
          resources: { requests: { cpu: 10m, memory: 16Mi } }
EOF
if [[ "$WORKLOAD_FAULT" == no-sa ]]; then
  kubectl -n "$NS" rollout status "deployment/${SA}" --timeout=120s
else
  # The ReplicaSet cannot create Pods for a ServiceAccount that does not exist.
  sleep 5
fi

[[ "$(kubectl auth can-i list pods -A --as="system:serviceaccount:${NS}:${SA}" || true)" == no ]] || { echo "${SA} can already list Pods" >&2; exit 1; }
