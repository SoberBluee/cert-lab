## Solution

The chain is `NodePort ${APP}-web` → `${APP}-web` (nginx) → `Service ${APP}-api` → `${APP}-api` Pods (Secret `${APP}-api-creds`). Each fault hides the next one, so work from the edge inwards.

```bash
kubectl -n ${NS} get pods,svc,endpointslices,networkpolicy
kubectl -n ${NS} logs deploy/${APP}-web --previous
kubectl -n ${NS} get networkpolicy ${APP}-web-egress -o yaml
```

### 1. The frontend's egress policy

<!-- fault DNS_FAULT=no-dns -->
nginx crashes with `host not found in upstream "${APP}-api"`, although the Service exists: name resolution itself fails. The egress policy only allows TCP 8080 to the API Pods, so DNS queries to CoreDNS (UDP/TCP 53 in `kube-system`) are dropped. Add a rule without removing the existing one:

```yaml
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
```
<!-- /fault -->
<!-- fault DNS_FAULT=dns-port -->
nginx crashes with `host not found in upstream "${APP}-api"`. The egress policy has a DNS rule, but for port `5353`. CoreDNS answers on `53`: change both ports of that rule.
<!-- /fault -->
<!-- fault DNS_FAULT=api-port -->
nginx runs, but requests time out (`504`). The egress rule to the API Pods allows TCP `80`: that is the Service port, but a NetworkPolicy sees the **Pod** port after the Service translated the address, and the API container listens on `8080`. Change the rule's port to `8080`.
<!-- /fault -->

Then `kubectl -n ${NS} rollout restart deploy/${APP}-web` instead of waiting for the CrashLoopBackOff timer.

### 2. The API Pods never start

```bash
kubectl -n ${NS} describe pod -l app=${APP}-api
```

<!-- fault API_FAULT=secret-key -->
`Error: couldn't find key api-token in Secret ${NS}/${APP}-api-creds`. `kubectl -n ${NS} get secret ${APP}-api-creds -o jsonpath='{.data}'` shows the key is `token`. The Secret must not change, so fix the Deployment: `env[0].valueFrom.secretKeyRef.key: token`.
<!-- /fault -->
<!-- fault API_FAULT=secret-name -->
`Error: secret "${APP}-api-credentials" not found`. The Secret is called `${APP}-api-creds`; fix `env[0].valueFrom.secretKeyRef.name` in the Deployment.
<!-- /fault -->
<!-- fault API_FAULT=image-tag -->
`ErrImagePull` / `ImagePullBackOff`: the image `busybox:1.366` does not exist. Use `busybox:1.36`:

```bash
kubectl -n ${NS} set image deploy/${APP}-api api=busybox:1.36
```
<!-- /fault -->

### 3. The API Service

<!-- fault SVC_FAULT=target-port -->
`502 Bad Gateway`. The Service targets the named port `api-http`, but the container port is called `http` (the EndpointSlice has no usable port). Set `targetPort: http` (or `8080`).
<!-- /fault -->
<!-- fault SVC_FAULT=selector -->
`502 Bad Gateway`. `kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=${APP}-api` shows no endpoints: the selector is `app: ${APP}-apis`. Set it to `app: ${APP}-api`.
<!-- /fault -->
<!-- fault SVC_FAULT=port -->
`502 Bad Gateway`. nginx proxies to `http://${APP}-api`, which means port `80`, but the Service only exposes port `8080`. Set the Service `port: 80` (keep `targetPort: http`).
<!-- /fault -->

### 4. Document

```bash
vim /opt/course/chain/causes.txt     # exactly three lines: resource and wrong field, one per fault above
curl http://controlplane:${NODEPORT}/
```
