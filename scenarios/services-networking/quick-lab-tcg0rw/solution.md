## Solution

### Question 1: app.${Q1_NS}.lab unreachable through the Gateway

**The healthy setup**

- Gateway `edge` (`${Q1_NS}-gw`), class `traefik`: listener `http` (HTTP, port `8000`) and listener `https` (HTTPS, port `8443`, terminating TLS with Secret `edge-tls`), both for hostname `app.${Q1_NS}.lab` and accepting routes from all namespaces
- HTTPRoute `shop` (`${Q1_NS}`): parent `${Q1_NS}-gw/edge` (both listeners), hostname `app.${Q1_NS}.lab`, backend Service `shop` in `${Q1_NS}-backend` on port `80`
- ReferenceGrant `allow-shop-routes` (`${Q1_NS}-backend`) lets HTTPRoutes of `${Q1_NS}` use Services of `${Q1_NS}-backend`

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=allowed-routes-same -->
#### Listeners only accept routes from their own namespace (`allowed-routes-same`)

Both listeners of Gateway `edge` have `allowedRoutes.namespaces.from: Same`, so they only accept routes from `${Q1_NS}-gw`. HTTPRoute `shop` lives in `${Q1_NS}`: its status says `Accepted: False` (`NotAllowedByListeners`). Allow the route's namespace: `from: All`, or `from: Selector` with a selector that matches `${Q1_NS}`.

```bash
kubectl -n "${Q1_NS}-gw" patch gateway edge --type=json -p '[{"op":"replace","path":"/spec/listeners/0/allowedRoutes/namespaces/from","value":"All"},{"op":"replace","path":"/spec/listeners/1/allowedRoutes/namespaces/from","value":"All"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=listener-hostname -->
#### Listener hostnames do not match the route (`listener-hostname`)

Both listeners of Gateway `edge` only serve `app.${Q1_NS}.local`, while the route and the users ask for `app.${Q1_NS}.lab`. The hostnames do not intersect, so the route is not attached (`NoMatchingListenerHostname`). Set the listener hostnames back to `app.${Q1_NS}.lab`.

```bash
kubectl -n "${Q1_NS}-gw" patch gateway edge --type=json -p '[{"op":"replace","path":"/spec/listeners/0/hostname","value":"app.'"${Q1_NS}"'.lab"},{"op":"replace","path":"/spec/listeners/1/hostname","value":"app.'"${Q1_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=listener-port -->
#### HTTP listener on a port the controller does not serve (`listener-port`)

The `http` listener of Gateway `edge` uses port `8080`. Traefik maps a listener to the entrypoint with the same port, and its entrypoints are `8000` (web, NodePort 30080) and `8443` (websecure, NodePort 30443), so nothing serves this listener: HTTPS works, HTTP does not, and the listener's status says it is not programmed. Compare with Gateway `traefik/traefik-gateway`, whose `web` listener uses `8000`, and set the port back.

```bash
kubectl -n "${Q1_NS}-gw" patch gateway edge --type=json -p '[{"op":"replace","path":"/spec/listeners/0/port","value":8000}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=https-listener-secret -->
#### HTTPS listener refers to a Secret that does not exist (`https-listener-secret`)

The `https` listener's `tls.certificateRefs` names Secret `edge-tls-2024`, which does not exist in `${Q1_NS}-gw`; the certificate is in `edge-tls`. The listener reports `ResolvedRefs: False` (`InvalidCertificateRef`) in `kubectl -n ${Q1_NS}-gw describe gateway edge`, and HTTPS fails while HTTP works. Point the listener back at `edge-tls`.

```bash
kubectl -n "${Q1_NS}-gw" patch gateway edge --type=json -p '[{"op":"replace","path":"/spec/listeners/1/tls/certificateRefs/0/name","value":"edge-tls"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=gatewayclass-missing -->
#### Gateway names a GatewayClass that does not exist (`gatewayclass-missing`)

Gateway `edge` uses `gatewayClassName: traefik-internal`, and no such GatewayClass exists (`kubectl get gatewayclass` lists only `traefik`). No controller claims the Gateway, so its status stays `Accepted: Unknown` ("Waiting for controller") and nothing serves either listener. Use class `traefik`; the field is part of the Gateway's identity for its controller, so re-create the Gateway if an edit is refused.

```bash
kubectl -n "${Q1_NS}-gw" delete gateway edge --wait=true
kubectl apply -f - <<< '{"apiVersion":"gateway.networking.k8s.io/v1","kind":"Gateway","metadata":{"name":"edge","namespace":"'"${Q1_NS}"'-gw"},"spec":{"gatewayClassName":"traefik","listeners":[{"name":"http","protocol":"HTTP","port":8000,"hostname":"app.'"${Q1_NS}"'.lab","allowedRoutes":{"namespaces":{"from":"All"}}},{"name":"https","protocol":"HTTPS","port":8443,"hostname":"app.'"${Q1_NS}"'.lab","tls":{"mode":"Terminate","certificateRefs":[{"kind":"Secret","name":"edge-tls"}]},"allowedRoutes":{"namespaces":{"from":"All"}}}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-parent-namespace -->
#### The route's parentRef has no namespace (`route-parent-namespace`)

HTTPRoute `shop`'s parentRef names Gateway `edge` without a namespace, which means `edge` in the route's own namespace `${Q1_NS}`. There is none, so no Gateway takes the route and its status has no accepted parent. Add `namespace: ${Q1_NS}-gw` to the parentRef.

```bash
kubectl -n "${Q1_NS}" patch httproute shop --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"'"${Q1_NS}"'-gw"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=route-backend-namespace -->
#### The route's backendRef has no namespace (`route-backend-namespace`)

HTTPRoute `shop`'s backendRef names Service `shop` without a namespace, so it looks in `${Q1_NS}`, where there is no such Service: `ResolvedRefs: False` (`BackendNotFound`), and Traefik answers with an error. Add `namespace: ${Q1_NS}-backend` to the backendRef.

```bash
kubectl -n "${Q1_NS}" patch httproute shop --type=json -p '[{"op":"add","path":"/spec/rules/0/backendRefs/0/namespace","value":"'"${Q1_NS}"'-backend"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=reference-grant-missing -->
#### Cross-namespace backend without a ReferenceGrant (`reference-grant-missing`)

HTTPRoute `shop` (namespace `${Q1_NS}`) sends traffic to Service `shop` in `${Q1_NS}-backend`. A cross-namespace backend needs a ReferenceGrant in the backend's namespace, and there is none: the route says `ResolvedRefs: False` (`RefNotPermitted`). Create a ReferenceGrant in `${Q1_NS}-backend` that lets HTTPRoutes from `${Q1_NS}` reference Services.

```bash
kubectl apply -f - <<< '{"apiVersion":"gateway.networking.k8s.io/v1beta1","kind":"ReferenceGrant","metadata":{"name":"allow-shop-routes","namespace":"'"${Q1_NS}"'-backend"},"spec":{"from":[{"group":"gateway.networking.k8s.io","kind":"HTTPRoute","namespace":"'"${Q1_NS}"'"}],"to":[{"group":"","kind":"Service"}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=reference-grant-from -->
#### The ReferenceGrant trusts the wrong namespace (`reference-grant-from`)

ReferenceGrant `allow-shop-routes` exists, but it trusts HTTPRoutes from `${Q1_NS}-gw`, the Gateway's namespace. The grant is for the namespace of the object that holds the reference, which is the route's `${Q1_NS}`, so the route still says `RefNotPermitted`. Set `spec.from[0].namespace` to `${Q1_NS}`.

```bash
kubectl -n "${Q1_NS}-backend" patch referencegrant allow-shop-routes --type=json -p '[{"op":"replace","path":"/spec/from/0/namespace","value":"'"${Q1_NS}"'"}]'
```
<!-- /fault -->
