## Solution

### Question 1: Give ${Q1_DB} a local name

An `ExternalName` Service has no cluster IP and no endpoints: CoreDNS answers with a CNAME to the name you give it. The name must be complete. A short name such as `${Q1_DB}` is not expanded the way a client's search path would expand it, so the lookup fails with `bad address`.

```bash
kubectl -n "${Q1_NS}" create service externalname database --external-name "${Q1_DB}.data-tier.svc.cluster.local"
kubectl -n "${Q1_NS}" exec client -- wget -qO- http://database/
```

### Question 2: Cut ${Q2_SVC} over to api-v2

A Service can change type in place, so it keeps its UID. The API server clears the cluster IP by itself when the type becomes `ExternalName`. The old selector stays in the spec, but it no longer does anything.

```bash
kubectl -n "${Q2_NS}" patch service "${Q2_SVC}" --type=merge -p '{"spec":{"type":"ExternalName","externalName":"api-v2.platform.svc.cluster.local"}}'
kubectl -n "${Q2_NS}" delete deployment "${Q2_SVC}"
kubectl -n "${Q2_NS}" exec client -- wget -qO- http://${Q2_SVC}/
```

ExternalName only changes DNS. Traffic goes straight to the target, on the port the client asked for, so the target must listen on that port.
