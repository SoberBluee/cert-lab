## Solution

```bash
k -n ${NS} get httproute ${APP} -o yaml
k -n ${NS} describe httproute ${APP}       # Parents: Accepted / ResolvedRefs conditions
k -n traefik get gateway traefik-gateway -o yaml
```

### Hop 1: the route does not attach to the Gateway

<!-- fault PARENT_FAULT=section-name -->
`parentRefs[0].sectionName` is `websecure`, but Gateway `traefik-gateway` has only one listener, `web` (`k -n traefik get gateway traefik-gateway -o jsonpath='{.spec.listeners[*].name}'`). Set `sectionName: web`.
<!-- /fault -->
<!-- fault PARENT_FAULT=namespace -->
`parentRefs[0]` has no `namespace`, so it refers to a Gateway `traefik-gateway` in `${NS}`, which does not exist. Add `namespace: traefik`.
<!-- /fault -->
<!-- fault PARENT_FAULT=gateway-name -->
`parentRefs[0].name` is `traefik-gw`; the Gateway is called `traefik-gateway` (`k -n traefik get gateways`). Fix the name.
<!-- /fault -->

### Hop 2: the route does not match, or points at the wrong port

<!-- fault ROUTE_FAULT=hostname -->
`hostnames` contains the host with `.lcoal` instead of `.local`, so even an accepted route never matches `Host: ${HOST}` and Traefik keeps answering `404`. Set it to `${HOST}`.
<!-- /fault -->
<!-- fault ROUTE_FAULT=path -->
The rule only matches `PathPrefix /${APP}`, so a request for `/` still gets `404`. The task asks for `/`: change the prefix to `/` (or remove the match).
<!-- /fault -->
<!-- fault ROUTE_FAULT=backend-port -->
The route matches, but `backendRefs[0].port` is `8080`. A backendRef names the **Service** port, and Service `${APP}` exposes `80`; `describe httproute` shows `ResolvedRefs False`. Set the port to `80`.
<!-- /fault -->

```bash
k -n ${NS} edit httproute ${APP}
# spec:
#   parentRefs:
#   - name: traefik-gateway
#     namespace: traefik
#     sectionName: web
#   hostnames:
#   - ${HOST}
#   rules:
#   - backendRefs:
#     - name: ${APP}
#       port: 80
```

### Hop 3: the backend has no usable endpoints

Now the route matches, but Traefik answers `503 Service Unavailable`:

```bash
k -n ${NS} get endpointslices
k -n ${NS} get pods
k -n ${NS} describe pod -l app=${APP}
```

<!-- fault BACKEND_FAULT=probe-path -->
The Pods are `0/1`: `Readiness probe failed: HTTP probe failed with statuscode: 404`. The probe asks nginx for `/healthz`, which does not exist. Point it at `/`:

```bash
k -n ${NS} patch deployment ${APP} --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
```
<!-- /fault -->
<!-- fault BACKEND_FAULT=probe-port -->
The Pods are `0/1`: `Readiness probe failed: ... connect: connection refused`. The probe checks port `8080`, but nginx listens on `80`:

```bash
k -n ${NS} patch deployment ${APP} --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":80}]'
```
<!-- /fault -->
<!-- fault BACKEND_FAULT=port-name -->
The Pods are Ready, but the EndpointSlice has no port. Service `${APP}` targets the port **named** `http`, and the container's port is named `web`. The Service must not change, so rename the container port:

```bash
k -n ${NS} patch deployment ${APP} --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"}]'
```
<!-- /fault -->

```bash
k -n ${NS} rollout status deployment ${APP}
curl -H 'Host: ${HOST}' http://controlplane:30080/
# ${APP} ok ${TOKEN}
```
