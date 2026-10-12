## Solution

`default-deny-ingress` selects every Pod and allows nothing. NetworkPolicies are additive, so add one that allows the frontend:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend
  namespace: app
spec:
  podSelector:
    matchLabels:
      role: backend
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend
      ports:
        - protocol: TCP
          port: 80
```

```bash
kubectl apply -f allow-frontend.yaml
kubectl -n app exec frontend -- wget -qO- -T 3 http://backend    # nginx welcome page
kubectl -n app exec intruder -- wget -qO- -T 3 http://backend    # times out
```

DNS still works because the deny-all only covers ingress in `app`; CoreDNS runs in `kube-system`.
