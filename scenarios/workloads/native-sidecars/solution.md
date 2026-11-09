## Solution

### Question 1: Job ${Q1_JOB} never finishes

A Pod with `restartPolicy: Never` finishes when all its containers have stopped, and `shipper` never stops. A native sidecar is an init container with `restartPolicy: Always`: it starts before `main`, keeps running beside it, and the kubelet stops it once the regular containers are done, so the Job can complete. Because `shipper` runs `sleep`, which ignores the stop signal, the Pod takes up to the `30` second grace period to finish.

The Pod template of a Job is immutable, so delete the Job and create it again with `shipper` moved under `initContainers`.

```bash
kubectl -n "${Q1_NS}" delete job "${Q1_JOB}"
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${Q1_JOB}
  namespace: ${Q1_NS}
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      initContainers:
        - name: shipper
          image: busybox:1.36
          restartPolicy: Always
          command: ["sleep", "infinity"]
      containers:
        - name: main
          image: busybox:1.36
          command: ["sh", "-c", "echo processing; sleep 5; echo finished"]
EOF
```

### Question 2: ${Q2_APP} restarts on every rollout

Regular containers start together, so `app` runs before `proxy` listens and exits. A native sidecar starts first, and the main containers wait until its `startupProbe` passes. Without a startup probe they wait only until the sidecar process has started, which is too early here.

Move `proxy` under `initContainers`, with `restartPolicy: Always` and a startup probe:

```yaml
initContainers:
  - name: proxy
    image: busybox:1.36
    restartPolicy: Always
    command: ["sh", "-c", "sleep 8; mkdir -p /w; echo up > /w/index.html; exec httpd -f -p 9000 -h /w"]
    startupProbe:
      tcpSocket: { port: 9000 }
      periodSeconds: 2
      failureThreshold: 30
```
