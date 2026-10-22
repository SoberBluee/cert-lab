## Solution

### Question 1: CronJob ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
spec:
  schedule: "${Q1_SCHEDULE}"
  jobTemplate:
    spec:
      completions: ${Q1_COMPLETIONS}
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: "${Q1_NAME}"
              image: busybox:1.36
              command:
                - sh
                - -c
                - date; echo done
      backoffLimit: ${Q1_LIMITS_BACKOFF}
      activeDeadlineSeconds: ${Q1_LIMITS_DEADLINE}
EOF
kubectl -n "${Q1_NS}" create job "${Q1_NAME}-manual" --from="cronjob/${Q1_NAME}"
kubectl -n "${Q1_NS}" wait --for=condition=Complete "job/${Q1_NAME}-manual" --timeout=240s
```
