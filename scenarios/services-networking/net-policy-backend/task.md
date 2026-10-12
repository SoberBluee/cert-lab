Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Namespace `app` runs three Pods: `backend` (nginx, exposed by Service `backend`), `frontend` and `intruder`. A NetworkPolicy currently blocks all incoming traffic in the namespace, so `frontend` can no longer reach `backend`.

Create a NetworkPolicy named `allow-frontend` in namespace `app` so that:

- Pods labelled `role=backend` accept traffic on TCP port `80` from Pods labelled `role=frontend` in the same namespace.
- All other incoming traffic to `backend` stays blocked, including from `intruder`.

Do not delete or change the existing `default-deny-ingress` policy, and do not change any Pod labels.
