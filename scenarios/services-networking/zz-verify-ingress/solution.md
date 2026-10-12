## Solution

### Question 1: ${Q1_APP} unreachable through the ingress

This run's fault: **`${Q1_FAULT}`**.

Every fault this question can roll:

#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `${Q1_APP}-svc`, which does not exist, so Traefik has nothing to send `www.${Q1_NS}.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `${Q1_APP}`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"'"${Q1_APP}"'"}]'
```

#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q1_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```

#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.${Q1_NS}.lab`. Set the class back to `traefik`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```

#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q1_NS}" patch ingress "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```

#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```

#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```

#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q1_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q1_NS}" patch httproute "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
