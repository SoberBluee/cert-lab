## Solution

### Question 1: CronJob ${Q1_CJ} stopped running

`concurrencyPolicy: Forbid` skips a new run while the previous one is active. One run is hung, and `status.active` still lists it, so every later run is skipped with no error at all. Two steps are needed: a deadline for future runs, and removing the stuck one, because a change to the template does not touch Jobs that already exist.

```bash
kubectl -n "${Q1_NS}" patch cronjob "${Q1_CJ}" --type=merge -p '{"spec":{"jobTemplate":{"spec":{"activeDeadlineSeconds":45}}}}'
stuck="$(kubectl -n "${Q1_NS}" get cronjob "${Q1_CJ}" -o jsonpath='{.status.active[0].name}')"
kubectl -n "${Q1_NS}" delete job "$stuck"
```

The next run starts at the top of the next minute.

### Question 2: Pause ${Q2_CJ} and run it once

`suspend: true` stops new runs without deleting anything. `kubectl create job --from` copies the CronJob's template into a Job and starts it at once, whether or not the CronJob is suspended.

```bash
kubectl -n "${Q2_NS}" patch cronjob "${Q2_CJ}" --type=merge -p '{"spec":{"suspend":true}}'
kubectl -n "${Q2_NS}" create job "${Q2_CJ}-manual" --from="cronjob/${Q2_CJ}"
```
