## Solution

### Question 1: CronJob ${Q1_APP} never succeeds

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=suspended -->
#### CronJob suspended (`suspended`)

The CronJob has `suspend: true`, so it never creates a Job: `kubectl get cronjob` shows `SUSPEND True` and no `LAST SCHEDULE`. Set `suspend: false`.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=merge -p '{"spec":{"suspend":false}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=never-schedule -->
#### Schedule that never fires (`never-schedule`)

The schedule is `0 0 31 2 *`: midnight on February 31st, a date that never comes. It is valid cron syntax, so the API accepts it, but no Job is ever created. Set it back to `* * * * *`.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=merge -p '{"spec":{"schedule":"* * * * *"}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=deadline -->
#### Job time limit shorter than the work (`deadline`)

Each Job has `activeDeadlineSeconds: 3`, but the command sleeps 8 seconds, so every Job is killed and marked failed with reason `DeadlineExceeded` (`kubectl describe job`). Remove the deadline.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/jobTemplate/spec/activeDeadlineSeconds"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=backoff-zero-command -->
#### Job command fails and is never retried (`backoff-zero-command`)

The command runs `ech` instead of `echo`, so the container exits with code 127 (`kubectl logs` shows `sh: ech: not found`), and `backoffLimit: 0` fails the Job on the first error. Fix the command and set `backoffLimit` back to `2`.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/backoffLimit","value":2},{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/command/2","value":"date; sleep 8; echo report done"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=image-registry -->
#### Image from a registry that does not exist (`image-registry`)

The image is `registry.invalid/busybox:1.36`, a registry host that does not resolve. The Jobs are created, but their Pods sit in `ErrImagePull` / `ImagePullBackOff` and never finish. Set the image back to `busybox:1.36`; the stuck Jobs can be deleted.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/jobTemplate/spec/template/spec/containers/0/image","value":"busybox:1.36"}]'
```
<!-- /fault -->
