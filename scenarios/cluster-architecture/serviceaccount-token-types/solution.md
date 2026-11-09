## Solution

### Question 1: Give ${Q1_POD} a token for one audience

`automountServiceAccountToken: false` removes the default mount. A projected `serviceAccountToken` source asks the kubelet for a token bound to this Pod, with the audience and lifetime you choose, and the kubelet renews it before it expires. The `path` is relative to the volume's mount point.

```bash
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q1_POD}
  namespace: ${Q1_NS}
spec:
  serviceAccountName: ${Q1_SA}
  automountServiceAccountToken: false
  containers:
    - name: main
      image: busybox:1.36
      command: ["sleep", "1d"]
      volumeMounts:
        - { name: token, mountPath: /var/run/vault, readOnly: true }
  volumes:
    - name: token
      projected:
        sources:
          - serviceAccountToken:
              path: token
              audience: ${Q1_AUD}
              expirationSeconds: 3600
EOF
```

### Question 2: Tokens for ${Q2_SA}

There are three kinds of token here, and they differ in how long they live:

- a **projected** token (question 1) is short-lived and renewed for you
- `kubectl create token` gives a short-lived token that nothing renews
- a Secret of type `kubernetes.io/service-account-token` gets a token with no expiry, filled in by the control plane. It needs the annotation that names the ServiceAccount, and it stays valid until the Secret is deleted, so use it only when nothing else works

```bash
kubectl -n "${Q2_NS}" create role "${Q2_SA}-pods" --verb=list --resource=pods
kubectl -n "${Q2_NS}" create rolebinding "${Q2_SA}-pods" --role="${Q2_SA}-pods" --serviceaccount="${Q2_NS}:${Q2_SA}"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${Q2_SA}-token
  namespace: ${Q2_NS}
  annotations:
    kubernetes.io/service-account.name: ${Q2_SA}
type: kubernetes.io/service-account-token
EOF
kubectl -n "${Q2_NS}" create token "${Q2_SA}" --duration=1h > "/opt/course/tokens/${Q2_SA}.txt"
```
