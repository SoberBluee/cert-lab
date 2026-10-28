## Solution

### Question 1: DNS record for ${Q1_HOST}

```bash
kubectl -n kube-system get configmap coredns -o json | jq --arg ip "${Q1_IP}" --arg host "${Q1_HOST}" '.data.Corefile |= sub("(?<i> +)prometheus :9153"; "\(.i)hosts {\n\(.i)   \($ip) \($host)\n\(.i)   fallthrough\n\(.i)}\n\(.i)prometheus :9153")' | kubectl replace -f -
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
