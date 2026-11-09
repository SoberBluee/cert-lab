#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q1_POD}
  namespace: ${Q1_NS}
spec:
  serviceAccountName: ${Q1_SA}
  automountServiceAccountToken: false
  containers:
    - name: main
      image: busybox:1.36
      command: ["sleep", "1d"]
      volumeMounts:
        - { name: token, mountPath: /var/run/vault, readOnly: true }
  volumes:
    - name: token
      projected:
        sources:
          - serviceAccountToken:
              path: token
              audience: ${Q1_AUD}
              expirationSeconds: 3600
EOF

# Question 2
kubectl -n "${Q2_NS}" create role "${Q2_SA}-pods" --verb=list --resource=pods
kubectl -n "${Q2_NS}" create rolebinding "${Q2_SA}-pods" --role="${Q2_SA}-pods" --serviceaccount="${Q2_NS}:${Q2_SA}"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${Q2_SA}-token
  namespace: ${Q2_NS}
  annotations:
    kubernetes.io/service-account.name: ${Q2_SA}
type: kubernetes.io/service-account-token
EOF
kubectl -n "${Q2_NS}" create token "${Q2_SA}" --duration=1h > "/opt/course/tokens/${Q2_SA}.txt"
