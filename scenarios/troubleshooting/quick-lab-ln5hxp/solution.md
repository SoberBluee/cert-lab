## Solution

### Question 1: Pods of ${Q1_NS} in order

```bash
kubectl -n ${Q1_NS} get pods --sort-by=.metadata.creationTimestamp --no-headers -o custom-columns=NAME:.metadata.name > /opt/course/sort/pods.txt
kubectl -n ${Q1_NS} get pods --field-selector=status.phase!=Running --no-headers -o custom-columns=NAME:.metadata.name > /opt/course/sort/not-running.txt
```
