## Solution

### Question 1: Rollout of ${Q1_APP} is stuck

`maxSurge: 1` with `maxUnavailable: 0` means a fourth Pod has to start before any old Pod stops. The quota allows `3` Pods, so the new ReplicaSet fails with `exceeded quota`, and because no old Pod may go first, it stays that way. The Deployment still looks healthy with `3` ready replicas, which makes this easy to miss: the message is on the ReplicaSet.

Let an old Pod go first instead. `Recreate` also works, but it takes every Pod down at once.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" -p '{"spec":{"strategy":{"rollingUpdate":{"maxSurge":0,"maxUnavailable":1}}}}'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}"
```

### Question 2: Catch a failed rollout of ${Q2_APP}

`progressDeadlineSeconds` is how long a rollout may go without progress before it is marked as failed. It does not stop the rollout or roll it back by itself: it sets the `Progressing` condition to `False` with reason `ProgressDeadlineExceeded`, and `kubectl rollout status` exits with an error, which is what a pipeline can act on. The old Pods keep serving meanwhile.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" -p '{"spec":{"progressDeadlineSeconds":20,"minReadySeconds":3}}'
kubectl -n "${Q2_NS}" set image "deployment/${Q2_APP}" web=nginx:0.0-missing
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}"
kubectl -n "${Q2_NS}" get deployment "${Q2_APP}" -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}' > /opt/course/rollout/reason.txt
kubectl -n "${Q2_NS}" rollout undo "deployment/${Q2_APP}"
```
