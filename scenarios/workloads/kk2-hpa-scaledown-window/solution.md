# HPA with scale-down window

Create `autoscaling/v2` HPA `${APP}-hpa`: target Deployment `${APP}`, min 1, max 3, CPU 50%, `behavior.scaleDown.stabilizationWindowSeconds: 300`.
