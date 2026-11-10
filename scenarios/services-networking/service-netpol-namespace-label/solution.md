## Solution

### Question 1: Service ${Q1_APP} unreachable

**The healthy setup**

- Deployment `${Q1_APP}`: `2` replicas of `nginx:1.27-alpine` labelled `app=${Q1_APP}`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `${Q1_APP}`: `ClusterIP`, selecting `app=${Q1_APP}`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `${Q1_NS}` from reaching `${Q1_APP}` on port `80`, and kube-proxy runs on every node
- `${Q1_APP}-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=netpol-namespace-label -->
#### An allow-same-namespace NetworkPolicy selects a label namespaces lack (`netpol-namespace-label`)

NetworkPolicy `${Q1_APP}-same-namespace` means to let in every Pod of `${Q1_NS}`, but it selects namespaces labelled `name=${Q1_NS}`. Namespaces do not get that label: Kubernetes labels each one `kubernetes.io/metadata.name=<name>` (`kubectl get namespace ${Q1_NS} --show-labels`). So the policy matches no namespace, lets nothing in, and still isolates the ${Q1_APP} Pods. Select `kubernetes.io/metadata.name: ${Q1_NS}` instead. Labelling the namespace `name=${Q1_NS}` would work too.

```bash
kubectl -n "${Q1_NS}" patch networkpolicy "${Q1_APP}-same-namespace" --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"'"${Q1_NS}"'"}}]'
```
<!-- /fault -->
