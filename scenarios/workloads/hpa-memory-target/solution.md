## Solution

### Question 1: Autoscaler of ${Q1_APP} shows no memory use

A `Utilization` target is a percentage of the Pods' **request**. The container requests CPU but no memory, so there is nothing to divide by: `kubectl describe hpa` shows `ScalingActive False` and `FailedGetResourceMetric` with "missing request for memory". Give the container a memory request. Any sensible value works; the autoscaler reads the new Pods about a minute after the rollout.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"64Mi"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}"
kubectl -n "${Q1_NS}" get hpa "${Q1_APP}"
```

### Question 2: Scale ${Q2_APP} on average memory

An `AverageValue` target is an absolute amount per Pod, so unlike `Utilization` it needs no request. Write it as `autoscaling/v2` YAML.

```bash
kubectl apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${Q2_APP}
  minReplicas: 1
  maxReplicas: 3
  metrics:
    - type: Resource
      resource:
        name: memory
        target:
          type: AverageValue
          averageValue: 50Mi
EOF
```

This shows why memory is a poor scaling signal for many apps: extra Pods share CPU load, but each one here loads the same data, so the average stays near `80Mi` and the autoscaler goes straight to its maximum and stays there.
