## Solution

### Question 1: HTTPS Gateway

```bash
kubectl -n ${Q1_NS} create secret tls web-tls --cert=/opt/course/tls/${Q1_NS}/tls.crt --key=/opt/course/tls/${Q1_NS}/tls.key
kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: web-gw
  namespace: ${Q1_NS}
spec:
  gatewayClassName: traefik
  listeners:
    - name: https
      protocol: HTTPS
      port: 8443
      hostname: secure.${Q1_NS}.lab
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: web-tls
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: ${Q1_NS}
spec:
  parentRefs:
    - name: web-gw
      sectionName: https
  hostnames: [secure.${Q1_NS}.lab]
  rules:
    - matches: [{ path: { type: PathPrefix, value: / } }]
      backendRefs: [{ name: web, port: 80 }]
EOF
```
