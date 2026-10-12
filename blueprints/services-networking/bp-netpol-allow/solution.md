## Solution

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-${CLIENT}
  namespace: ${NS}
spec:
  podSelector:
    matchLabels: { role: ${BACKEND} }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { role: ${CLIENT} }
      ports:
        - { protocol: TCP, port: 80 }
```

```bash
kubectl apply -f allow.yaml
kubectl -n ${NS} exec ${CLIENT} -- wget -qO- -T 3 http://${BACKEND}     # works
kubectl -n ${NS} exec intruder -- wget -qO- -T 3 http://${BACKEND}      # times out
```
