# Pods cannot be created

ValidatingWebhookConfiguration `orphan-validate` selects namespaces labelled `webhook-lab=true` and calls Service `${NS}/missing-webhook-svc`, which does not exist. With `failurePolicy: Fail`, every Pod create times out and the ReplicaSet stays at 0 ready Pods (`FailedCreate` / webhook errors in the Events). Delete the orphan webhook:

```bash
kubectl delete validatingwebhookconfiguration orphan-validate
```
