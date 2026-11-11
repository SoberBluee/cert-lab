## Solution

### Question 1: Pod ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
spec:
  containers:
    - name: main
      image: "${Q1_IMAGE}"
      command:
        - sleep
        - 1d
      securityContext:
        runAsUser: ${Q1_SEC_USER}
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
      volumeMounts:
        - name: init
          mountPath: /init
  volumes:
    - name: init
      emptyDir: {}
  initContainers:
    - name: prepare
      image: busybox:1.36
      command:
        - sh
        - -c
        - "echo ${Q1_INIT_TEXT} > /init/ready"
      volumeMounts:
        - name: init
          mountPath: /init
EOF
kubectl -n "${Q1_NS}" wait --for=condition=Ready "pod/${Q1_NAME}" --timeout=180s
kubectl -n "${Q1_NS}" annotate pod "${Q1_NAME}" "${Q1_NOTE_KEY}=${Q1_NOTE_VALUE}" --overwrite
```
