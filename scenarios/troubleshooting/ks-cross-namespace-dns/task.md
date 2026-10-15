Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `frontend` in namespace `${CLIENT_NS}` calls the API in namespace `${API_NS}` at

```
http://api.${API_NS}.svc.cluster.local
```

but every request fails. The platform team says the network is locked down "exactly as designed".

Fix every problem along the way, so that this command returns the API payload:

```
kubectl -n ${CLIENT_NS} exec deploy/frontend -- wget -qO- -T 4 http://api.${API_NS}.svc.cluster.local
```

Constraints:

- Keep NetworkPolicy `default-deny-egress` in `${CLIENT_NS}`: Pods there may only talk to cluster DNS and to the API, nothing else.
- Keep NetworkPolicy `api-ingress` in `${API_NS}`: only Pods in namespace `${CLIENT_NS}` may reach the API Pods. Pod `canary` in namespace `default` must stay blocked.
- Do not modify Deployment `frontend`.
