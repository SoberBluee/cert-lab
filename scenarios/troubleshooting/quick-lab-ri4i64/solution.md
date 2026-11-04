## Solution

### Question 1: StatefulSet ${Q1_STS} is not healthy

**The healthy setup**

- Service `${Q1_STS}-hl`: headless (`clusterIP: None`), selecting `app=${Q1_STS}`, port `80`
- StatefulSet `${Q1_STS}`: `serviceName: ${Q1_STS}-hl`, `3` replicas, default `OrderedReady` Pod management and `RollingUpdate` strategy
- container `nginx`: image `nginx:1.27-alpine`, a readiness probe doing an HTTP GET of `/` on port `80`, claim template `data` mounted at `/data`
- claim template `data`: `100Mi`, `ReadWriteOnce`, StorageClass `local-path`

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=headless-clusterip -->
#### Service is not headless (`headless-clusterip`)

Service `${Q1_STS}-hl` has a cluster IP, so it is not headless: DNS answers its name with that one virtual IP, and creates no record `<pod>.${Q1_STS}-hl` for the Pods, so `nslookup ${Q1_STS}-0.${Q1_STS}-hl.${Q1_NS}.svc.cluster.local` fails from any Pod. `kubectl -n ${Q1_NS} get service ${Q1_STS}-hl` shows the CLUSTER-IP. `spec.clusterIP` cannot be changed: delete the Service and create it again with `clusterIP: None`, the same selector and port.

```bash
kubectl -n "${Q1_NS}" delete service "${Q1_STS}-hl"
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${Q1_STS}"'-hl","namespace":"'"${Q1_NS}"'"},"spec":{"clusterIP":"None","selector":{"app":"'"${Q1_STS}"'"},"ports":[{"name":"web","port":80}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-selector -->
#### Service selects none of the StatefulSet's Pods (`service-selector`)

Service `${Q1_STS}-hl` selects `app=${Q1_STS}-db`, a label no Pod has, so it has no endpoints (`kubectl -n ${Q1_NS} get endpointslices -l kubernetes.io/service-name=${Q1_STS}-hl`) and DNS has no records for the Pods. Set its selector to `app=${Q1_STS}`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_STS}-hl" -p '{"spec":{"selector":{"app":"'"${Q1_STS}"'"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=servicename-mismatch -->
#### StatefulSet names a governing Service that does not exist (`servicename-mismatch`)

The StatefulSet's `serviceName` is `${Q1_STS}-headless`, a Service that does not exist. Each Pod takes its DNS subdomain from it (`kubectl -n ${Q1_NS} get pod ${Q1_STS}-0 -o jsonpath='{.spec.subdomain}'`), so no name under `${Q1_STS}-hl` resolves, although that Service is right. `serviceName` cannot be changed on an existing StatefulSet: delete it, which keeps its claims, and create it again with `serviceName: ${Q1_STS}-hl`. The new Pods get the same claims back.

```bash
kubectl -n "${Q1_NS}" delete statefulset "${Q1_STS}" --cascade=foreground --wait=true
kubectl apply -f - <<< '{"apiVersion":"apps/v1","kind":"StatefulSet","metadata":{"name":"'"${Q1_STS}"'","namespace":"'"${Q1_NS}"'"},"spec":{"serviceName":"'"${Q1_STS}"'-hl","replicas":3,"selector":{"matchLabels":{"app":"'"${Q1_STS}"'"}},"template":{"metadata":{"labels":{"app":"'"${Q1_STS}"'"}},"spec":{"containers":[{"name":"nginx","image":"nginx:1.27-alpine","ports":[{"name":"web","containerPort":80}],"readinessProbe":{"httpGet":{"path":"/","port":80},"periodSeconds":5},"volumeMounts":[{"name":"data","mountPath":"/data"}]}]}},"volumeClaimTemplates":[{"metadata":{"name":"data"},"spec":{"accessModes":["ReadWriteOnce"],"storageClassName":"local-path","resources":{"requests":{"storage":"100Mi"}}}}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=claim-class-typo -->
#### Claim template names a StorageClass that does not exist (`claim-class-typo`)

Pod `${Q1_STS}-0` stays `Pending`, and with `OrderedReady` Pod management the StatefulSet creates no further Pod until it is ready. Its claim `data-${Q1_STS}-0` is `Pending` too: the claim template asks for StorageClass `local-storage`, which does not exist (`kubectl get storageclass`, and the claim's Events). Neither a StatefulSet's claim templates nor a claim's class can be changed: delete the StatefulSet and its `Pending` claim, and create the StatefulSet again with `storageClassName: local-path`.

```bash
kubectl -n "${Q1_NS}" delete statefulset "${Q1_STS}" --cascade=foreground --wait=true
kubectl -n "${Q1_NS}" delete pvc -l app="${Q1_STS}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"apps/v1","kind":"StatefulSet","metadata":{"name":"'"${Q1_STS}"'","namespace":"'"${Q1_NS}"'"},"spec":{"serviceName":"'"${Q1_STS}"'-hl","replicas":3,"selector":{"matchLabels":{"app":"'"${Q1_STS}"'"}},"template":{"metadata":{"labels":{"app":"'"${Q1_STS}"'"}},"spec":{"containers":[{"name":"nginx","image":"nginx:1.27-alpine","ports":[{"name":"web","containerPort":80}],"readinessProbe":{"httpGet":{"path":"/","port":80},"periodSeconds":5},"volumeMounts":[{"name":"data","mountPath":"/data"}]}]}},"volumeClaimTemplates":[{"metadata":{"name":"data"},"spec":{"accessModes":["ReadWriteOnce"],"storageClassName":"local-path","resources":{"requests":{"storage":"100Mi"}}}}]}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=readiness-forced-rollback -->
#### Broken readiness probe, and a Pod the fix never replaces (`readiness-forced-rollback`)

The readiness probe asks for `/healthz`, which nginx answers with 404, so `${Q1_STS}-0` runs but is never ready, and with `OrderedReady` Pod management `${Q1_STS}-1` and `${Q1_STS}-2` are never created. Set the probe's path back to `/`. That alone is not enough: the controller waits for `${Q1_STS}-0` to become ready before it replaces it, which it never does, so the Pod keeps the broken probe (Kubernetes documents this under "Forced rollback"). Delete `${Q1_STS}-0` once the template is fixed; it comes back with the new probe and keeps its claim.

```bash
kubectl -n "${Q1_NS}" patch statefulset "${Q1_STS}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
# Once the controller has seen the new template, re-create the Pod it waits on.
for _ in $(seq 1 15); do
  [[ "$(kubectl -n "${Q1_NS}" get statefulset "${Q1_STS}" -o jsonpath='{.status.updateRevision}')" != "$(kubectl -n "${Q1_NS}" get pod "${Q1_STS}-0" -o jsonpath='{.metadata.labels.controller-revision-hash}')" ]] && break
  sleep 1
done
kubectl -n "${Q1_NS}" delete pod "${Q1_STS}-0"
```
<!-- /fault -->
