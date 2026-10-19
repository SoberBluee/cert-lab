# Record worker-1 capacity

```bash
kubectl get node worker-1 -o jsonpath='{.status.capacity.cpu}'
kubectl get node worker-1 -o jsonpath='{.status.capacity.memory}'
echo "cpu: <value>" > /opt/course/worker-1-cpu.txt
echo "memory: <value>" > /opt/course/worker-1-memory.txt
```
