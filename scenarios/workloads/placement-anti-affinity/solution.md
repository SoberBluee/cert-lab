## Solution

### Question 1: Separate the replicas of ${Q1_APP}

Two things stand in the way.

The Pod template has `nodeSelector: kubernetes.io/hostname: worker-1`, so every replica can only go to that worker. Adding anti-affinity alone leaves the second replica `Pending`, because the one node it may use already holds a Pod of the app. Remove the nodeSelector.

The default rolling update then gets stuck. With `2` replicas it rounds to `maxSurge: 1` and `maxUnavailable: 0`, so it starts a new Pod before it stops an old one. Old and new Pods share the `app` label, so the anti-affinity counts the old Pods too. The first new Pod lands on the free worker. The last one has nowhere to go, because an old Pod still holds the other worker, and that old Pod is never removed because that would drop below `2` available. Allow one Pod to go first (`maxSurge: 0`, `maxUnavailable: 1`). The `Recreate` strategy, or scaling to `0` and back to `2`, also works.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" -p '{"spec":{"strategy":{"rollingUpdate":{"maxSurge":0,"maxUnavailable":1}},"template":{"spec":{"nodeSelector":null,"affinity":{"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":[{"topologyKey":"kubernetes.io/hostname","labelSelector":{"matchLabels":{"app":"${Q1_APP}"}}}]}}}}}}'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}"
kubectl -n "${Q1_NS}" get pods -o wide
```

### Question 2: Run all replicas of ${Q2_APP}

Required anti-affinity on `kubernetes.io/hostname` allows one Pod per node. The control plane is tainted, so `2` workers fit `2` Pods and the third stays `Pending` with "didn't match pod anti-affinity rules". The preferred form only lowers a node's score, so the scheduler still spreads the Pods but can put a second one on a worker when it has to. Note the different shape: each entry has a `weight` and wraps the term in `podAffinityTerm`.

Changing the template is not enough on its own, because required anti-affinity works both ways. The scheduler keeps a new Pod off a node when a Pod already there has required anti-affinity against it, so the old Pods keep blocking the new ones even though the new ones only ask for a preference. Old Pods hold both workers, and the rolling update will not remove them until new Pods are ready. Use the `Recreate` strategy, or scale to `0` and back to `3`.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null},"template":{"spec":{"affinity":{"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":null,"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":100,"podAffinityTerm":{"topologyKey":"kubernetes.io/hostname","labelSelector":{"matchLabels":{"app":"${Q2_APP}"}}}}]}}}}}}'
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}"
```
