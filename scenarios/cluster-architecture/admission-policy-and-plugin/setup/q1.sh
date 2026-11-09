#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl label namespace "${Q1_NS}" policy=enforced --overwrite >/dev/null
kubectl apply -f - <<EOF
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-owner-label
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE"]
        resources: ["pods"]
  validations:
    - expression: "has(object.metadata.labels) && 'owner' in object.metadata.labels"
      message: "Pods in this namespace need an owner label"
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: require-owner-label
spec:
  policyName: require-owner-label
  validationActions: [Deny]
  matchResources:
    namespaceSelector:
      matchLabels: { policy: enforced }
EOF
refused=""
for _ in $(seq 1 30); do
  out="$(kubectl -n "${Q1_NS}" run admission-check --image=busybox:1.36 --dry-run=server 2>&1 || true)"
  [[ "$out" == *'owner label'* ]] && { refused=yes; break; }
  sleep 2
done
[[ -n "$refused" ]] || { echo "the policy does not refuse Pods: $out" >&2; exit 1; }
echo "$(kubectl get validatingadmissionpolicy require-owner-label -o jsonpath='{.metadata.uid}/{.metadata.generation}') $(kubectl get validatingadmissionpolicybinding require-owner-label -o jsonpath='{.metadata.uid}/{.metadata.generation}')" > /var/tmp/cka-q1.policy
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
  labels: { app: ${Q1_APP}, owner: platform }
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${Q1_APP} }
  template:
    metadata:
      labels: { app: ${Q1_APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
EOF
kubectl -n "${Q1_NS}" get deployment "${Q1_APP}" -o jsonpath='{.metadata.uid}' > /var/tmp/cka-q1.uid
chmod 644 /var/tmp/cka-q1.uid /var/tmp/cka-q1.policy
for _ in $(seq 1 30); do
  [[ -n "$(kubectl -n "${Q1_NS}" get replicaset -l "app=${Q1_APP}" -o jsonpath='{.items[*].status.conditions[?(@.type=="ReplicaFailure")].status}')" ]] && exit 0
  sleep 2
done
echo "expected the ReplicaSet to report a failure" >&2
exit 1
