## Solution

### Question 1: Kustomize: HPA in base, patched in prod

```bash
sed -i '/scaling-config.yaml/d' /opt/course/kustomize/${Q1_APP}-envs/base/kustomization.yaml
rm /opt/course/kustomize/${Q1_APP}-envs/base/scaling-config.yaml
cat > /opt/course/kustomize/${Q1_APP}-envs/base/hpa.yaml <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${Q1_APP}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${Q1_APP}
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
EOF
printf '  - hpa.yaml\n' >> /opt/course/kustomize/${Q1_APP}-envs/base/kustomization.yaml
cat > /opt/course/kustomize/${Q1_APP}-envs/overlays/prod/hpa-max.yaml <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${Q1_APP}
spec:
  maxReplicas: 6
EOF
printf '  - path: hpa-max.yaml\n' >> /opt/course/kustomize/${Q1_APP}-envs/overlays/prod/kustomization.yaml
kubectl apply -k /opt/course/kustomize/${Q1_APP}-envs/overlays/staging
kubectl apply -k /opt/course/kustomize/${Q1_APP}-envs/overlays/prod
# apply -k never deletes: the ConfigMap left the kustomization but not the cluster
kubectl -n ${Q1_APP}-staging delete configmap ${Q1_APP}-scaling
kubectl -n ${Q1_APP}-production delete configmap ${Q1_APP}-scaling
```
