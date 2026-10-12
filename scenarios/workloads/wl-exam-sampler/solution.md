## Solution

### Question 1

```bash
kubectl -n ${NS} scale deployment ${DEPLOY} --replicas=${REPLICAS}
kubectl -n ${NS} rollout status deployment/${DEPLOY}
```

### Question 2

`kubectl expose` copies the Deployment's selector. It cannot set the node port, so generate YAML and add it:

```bash
kubectl -n ${NS} expose deployment ${DEPLOY} --name=${DEPLOY}-np --type=NodePort --port=80 --target-port=80 $do > svc.yaml
vim svc.yaml        # under ports: add  nodePort: ${NODEPORT}
kubectl apply -f svc.yaml
curl -s http://controlplane:${NODEPORT} | head -3
```

### Question 3

```bash
kubectl -n ${NS} edit deployment ${DEPLOY}
```

```yaml
    spec:
      containers:
      - name: nginx
        env:
        - name: APP_MODE
          valueFrom:
            configMapKeyRef:
              name: ${CM}
              key: mode
```

```bash
kubectl -n ${NS} rollout status deployment/${DEPLOY}
kubectl -n ${NS} exec deploy/${DEPLOY} -- printenv APP_MODE     # ${MODE}
```

`kubectl set env --from=configmap/${CM}` would name the variable `MODE` (and add `LOG_LEVEL` too), so it does not meet the task.
