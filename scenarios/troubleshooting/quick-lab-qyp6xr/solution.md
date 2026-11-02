## Solution

### Question 1: API resources and Roles

```bash
kubectl api-resources --namespaced=true -o name > /opt/course/api-resources/namespaced.txt
for ns in $(kubectl get namespaces -o name | sed 's|^namespace/||' | grep "^${Q1_NS}-"); do
  echo "$ns $(kubectl -n "$ns" get roles --no-headers | wc -l)"
done | sort -k2 -n | tail -1 > /opt/course/api-resources/crowded.txt
```
