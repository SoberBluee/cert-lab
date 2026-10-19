#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl label namespace "${NS}" webhook-lab=true --overwrite

kubectl -n "${NS}" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
spec:
  replicas: 0
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
EOF

kubectl apply -f - <<EOF
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: orphan-validate
webhooks:
  - name: orphan.cka.lab
    failurePolicy: Fail
    sideEffects: None
    timeoutSeconds: 3
    admissionReviewVersions: [v1]
    clientConfig:
      service:
        name: missing-webhook-svc
        namespace: ${NS}
        path: /validate
      caBundle: LS0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0t
    rules:
      - apiGroups: [""]
        apiVersions: [v1]
        operations: [CREATE]
        resources: [pods]
        scope: Namespaced
    namespaceSelector:
      matchLabels: { webhook-lab: "true" }
EOF

kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
for _ in $(seq 1 30); do
  ready=$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)
  [[ "$ready" != 2 ]] && exit 0
  sleep 1
done
echo "${APP} is still healthy" >&2
exit 1
