## Solution

`allow-all-egress` selects every Pod and allows all egress. Policies are additive, so it must stop selecting `${CLIENT}`:

```yaml
# kubectl -n ${NS} edit networkpolicy allow-all-egress
spec:
  podSelector:
    matchExpressions: [{ key: role, operator: NotIn, values: [${CLIENT}] }]
```

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: ${CLIENT}-egress, namespace: ${NS} }
spec:
  podSelector: { matchLabels: { role: ${CLIENT} } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { role: ${DB} } } }]
      ports: [{ protocol: TCP, port: ${DB_PORT} }]
    - ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
```

Without the DNS rule, `wget http://${DB}:${DB_PORT}` fails with "bad address" even though the IP itself is allowed.
