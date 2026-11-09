#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/course/api-resources
chown -R ubuntu:ubuntu /opt/course
plural="$(echo "${Q1_KIND}" | tr '[:upper:]' '[:lower:]')s"
if [[ "${Q1_NAMESPACED}" == true ]]; then scope=Namespaced; else scope=Cluster; fi
kubectl apply -f - <<EOF
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ${plural}.${Q1_GROUP}
spec:
  group: ${Q1_GROUP}
  scope: ${scope}
  names:
    kind: ${Q1_KIND}
    plural: ${plural}
    singular: ${plural%s}
    shortNames: [${Q1_SHORT}]
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          x-kubernetes-preserve-unknown-fields: true
EOF
kubectl wait --for=condition=Established "crd/${plural}.${Q1_GROUP}" --timeout=60s
