## Solution

### Question 1: Canary by request header

```bash
kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: ${Q1_NS}
spec:
  parentRefs: [{ name: app-gw, sectionName: https }]
  hostnames: [app.${Q1_NS}.lab]
  rules:
    - matches: [{ headers: [{ name: X-Canary, value: always }] }]
      backendRefs: [{ name: web-canary, port: 80 }]
    - backendRefs: [{ name: web, port: 80 }]
EOF
```
