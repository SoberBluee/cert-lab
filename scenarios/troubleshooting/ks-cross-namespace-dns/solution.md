## Solution

Walk the path one hop at a time from the client: name resolution, then the client's egress policy, then the server's ingress policy, then the Service.

```bash
k -n ${CLIENT_NS} exec deploy/frontend -- nslookup api.${API_NS}.svc.cluster.local
k -n ${CLIENT_NS} get networkpolicy default-deny-egress -o yaml
k -n ${API_NS} get networkpolicy api-ingress -o yaml
k -n ${API_NS} get svc api -o yaml; k -n ${API_NS} get endpointslices
```

### Layer 1: the client's egress policy

<!-- fault EGRESS_FAULT=no-dns -->
`nslookup` times out. `default-deny-egress` in `${CLIENT_NS}` selects every Pod and only allows TCP 80 to the api Pods. Name resolution is egress too, to CoreDNS in `kube-system` on port 53. Add a second rule and keep the first:

```yaml
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
```
<!-- /fault -->
<!-- fault EGRESS_FAULT=dns-port -->
`nslookup` times out although `default-deny-egress` has a DNS rule: it allows port `5353` (mDNS), but CoreDNS answers on `53`. Change both ports of the second rule to `53`.
<!-- /fault -->
<!-- fault EGRESS_FAULT=api-port -->
The name resolves, but the request times out. The first rule of `default-deny-egress` allows TCP `8080` to the api Pods: the policy sees the **Pod** port after the Service translated the address, and nginx listens on `80`. Change it to `80`.
<!-- /fault -->

### Layer 2: the server's ingress policy

<!-- fault INGRESS_FAULT=ns-label -->
`api-ingress` in `${API_NS}` only admits namespaces labelled `team=frontend-web`:

```bash
k get ns ${CLIENT_NS} --show-labels      # team=frontend
k -n ${API_NS} edit networkpolicy api-ingress
#   - namespaceSelector: { matchLabels: { team: frontend } }
```
<!-- /fault -->
<!-- fault INGRESS_FAULT=pod-selector -->
`api-ingress` combines the namespace with `podSelector: app=web` in the **same** `from` entry, so both must match. The frontend Pods are labelled `app=frontend` (`k -n ${CLIENT_NS} get pods --show-labels`). Fix the label (or drop the podSelector; the namespaceSelector alone still keeps `canary` out).
<!-- /fault -->
<!-- fault INGRESS_FAULT=port -->
`api-ingress` admits the right namespace, but only on TCP `8080`. nginx listens on `80`; change the port.
<!-- /fault -->

Opening the policy to every namespace (`namespaceSelector: {}`) would also let `canary` in. That breaks the constraint.

### Layer 3: the Service

<!-- fault SERVICE_FAULT=target-port -->
The request reaches the Service but is refused: `targetPort: 8080`, while the container listens on `80` (the EndpointSlice shows port 8080).

```bash
k -n ${API_NS} patch svc api --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":80}]'
```
<!-- /fault -->
<!-- fault SERVICE_FAULT=selector -->
The Service has no endpoints: its selector is `app: api-server`, but the Pods are labelled `app: api`.

```bash
k -n ${API_NS} patch svc api --type=json -p '[{"op":"replace","path":"/spec/selector","value":{"app":"api"}}]'
```
<!-- /fault -->
<!-- fault SERVICE_FAULT=port-name -->
`targetPort: https` names a container port that does not exist (the container's port is named `http`), so the EndpointSlice lists the Pods without a usable port. Use `http` or `80`.

```bash
k -n ${API_NS} patch svc api --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":80}]'
```
<!-- /fault -->

```bash
k -n ${CLIENT_NS} exec deploy/frontend -- wget -qO- -T 4 http://api.${API_NS}.svc.cluster.local
# api ok ${TOKEN}
```
