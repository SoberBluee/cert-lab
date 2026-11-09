## Solution

### Question 1: Deployment ${Q1_APP} gets no Pods

A Deployment with no Pods at all, rather than Pending ones, means the API server refused them. `kubectl describe replicaset` shows the `FailedCreate` event, with the policy's message: `Pods in this namespace need an owner label`. ValidatingAdmissionPolicy `require-owner-label` checks a CEL expression on every new Pod, and its binding applies it to namespaces labelled `policy=enforced`.

The trap is that the Deployment already has an `owner` label, in its own metadata. The rule looks at Pods, so the label must be in the Pod template. Any value passes, and `spec.selector` stays as it is.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" -p '{"spec":{"template":{"metadata":{"labels":{"owner":"platform"}}}}}'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}"
```

### Question 2: Enable AlwaysPullImages

Admission plugins are API server flags, so edit the static Pod manifest on `controlplane`. Add to the list rather than replacing it, or `NodeRestriction` is lost. The kubelet restarts the API server by itself; `kubectl` fails for a moment while that happens.

```bash
sudo sed -i -E 's/(--enable-admission-plugins=[^[:space:]"]+)/\1,AlwaysPullImages/' /etc/kubernetes/manifests/kube-apiserver.yaml
kubectl run test --image=nginx:1.27-alpine --image-pull-policy=IfNotPresent --dry-run=server -o jsonpath='{.spec.containers[0].imagePullPolicy}'
```

The server-side dry run goes through admission without creating anything. It prints `Always`, whatever the Pod asked for.
