## Solution

### Question 1: Document and use a custom field

```bash
kubectl explain databases.spec.backup.schedule > /opt/course/crd/schedule.txt
kubectl create namespace ${Q1_NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: db.example.lab/v1
kind: Database
metadata:
  name: reports
  namespace: ${Q1_NS}
spec:
  replicas: 3
  backup:
    schedule: "0 2 * * *"
EOF
```
