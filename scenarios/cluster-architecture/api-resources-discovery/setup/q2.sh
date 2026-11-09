#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/course/api-resources
chown -R ubuntu:ubuntu /opt/course
kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
kubectl create namespace audit-archive >/dev/null 2>&1 || kubectl get namespace audit-archive >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: auditnotes.records.acme.example
spec:
  group: records.acme.example
  scope: Namespaced
  names: { kind: AuditNote, plural: auditnotes, singular: auditnote }
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          x-kubernetes-preserve-unknown-fields: true
EOF
kubectl wait --for=condition=Established crd/auditnotes.records.acme.example --timeout=60s >/dev/null
for _ in $(seq 1 30); do kubectl get auditnotes -A >/dev/null 2>&1 && break; sleep 1; done

# The objects to find, then decoys: the same label elsewhere, and other values here.
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata: { name: retention, namespace: ${Q2_NS}, labels: { audit: ${Q2_FLAG} } }
data: { days: "30" }
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: exporter, namespace: ${Q2_NS}, labels: { audit: ${Q2_FLAG} } }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: open-egress, namespace: ${Q2_NS}, labels: { audit: ${Q2_FLAG} } }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress: [{}]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: secret-reader, namespace: ${Q2_NS}, labels: { audit: ${Q2_FLAG} } }
rules:
  - { apiGroups: [""], resources: [secrets], verbs: [get, list] }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: secret-reader, namespace: ${Q2_NS}, labels: { audit: ${Q2_FLAG} } }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: secret-reader }
subjects:
  - { kind: ServiceAccount, name: exporter, namespace: ${Q2_NS} }
---
apiVersion: records.acme.example/v1
kind: AuditNote
metadata: { name: finding-17, namespace: ${Q2_NS}, labels: { audit: ${Q2_FLAG} } }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: settings, namespace: ${Q2_NS}, labels: { audit: passed } }
data: { mode: "safe" }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: pod-reader, namespace: ${Q2_NS}, labels: { audit: passed } }
rules:
  - { apiGroups: [""], resources: [pods], verbs: [get, list] }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: archived, namespace: audit-archive, labels: { audit: ${Q2_FLAG} } }
data: { old: "true" }
EOF
cat > /var/tmp/cka-q2.flagged <<EOF
auditnote.records.acme.example/finding-17
configmap/retention
networkpolicy.networking.k8s.io/open-egress
role.rbac.authorization.k8s.io/secret-reader
rolebinding.rbac.authorization.k8s.io/secret-reader
serviceaccount/exporter
EOF
chmod 644 /var/tmp/cka-q2.flagged
