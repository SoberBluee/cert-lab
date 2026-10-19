Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` (and Service `${APP}-svc`) already exist in namespace `${NS}`.

Create HorizontalPodAutoscaler `${APP}-hpa` that:

- targets Deployment `${APP}`
- scales on average CPU utilization of `50%`
- uses minimum `1` and maximum `3` replicas
- sets scale-down `stabilizationWindowSeconds` to `300`
