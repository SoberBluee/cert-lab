## Solution

The chain is `NodePort ${APP}-web` → `${APP}-web` (nginx) → `Service ${APP}-api` → `${APP}-api` Pods (Secret `${APP}-api-creds`). Each fault hides the next one, so work from the edge inwards.

### 1. Frontend crashes: DNS is blocked

```bash
kubectl -n ${NS} get pods
kubectl -n ${NS} logs deploy/${APP}-web --previous
# host not found in upstream "${APP}-api"
kubectl -n ${NS} get svc ${APP}-api          # the Service exists, so name resolution itself fails
kubectl -n ${NS} get networkpolicy ${APP}-web-egress -o yaml
```

The egress policy only allows TCP 8080 to the API Pods. DNS queries to CoreDNS (UDP/TCP 53 in `kube-system`) are dropped. Add a rule without removing the existing one:

```yaml
  egress:
    - to: [{ podSelector: { matchLabels: { app: ${APP}-api } } }]
      ports: [{ protocol: TCP, port: 8080 }]
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
```

Then `kubectl -n ${NS} rollout restart deploy/${APP}-web` instead of waiting for the CrashLoopBackOff timer.

### 2. API Pods never start: wrong Secret key

```bash
kubectl -n ${NS} describe pod -l app=${APP}-api
# Error: couldn't find key api-token in Secret ${NS}/${APP}-api-creds
kubectl -n ${NS} get secret ${APP}-api-creds -o jsonpath='{.data}'
```

The Secret must not change, so fix the Deployment: `env[0].valueFrom.secretKeyRef.key: token`.

### 3. 502 Bad Gateway: Service targetPort

```bash
kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=${APP}-api
kubectl -n ${NS} get svc ${APP}-api -o jsonpath='{.spec.ports}'
```

The Service targets the named port `api-http`, but the container port is called `http`. Set `targetPort: http` (or `8080`).

### 4. Document

```bash
cat > /opt/course/chain/causes.txt <<'EOF'
networkpolicy/${APP}-web-egress: egress did not allow DNS (UDP/TCP 53)
deployment/${APP}-api: secretKeyRef key api-token does not exist (key is token)
service/${APP}-api: targetPort api-http does not match container port name http
EOF
curl http://controlplane:${NODEPORT}/
```
