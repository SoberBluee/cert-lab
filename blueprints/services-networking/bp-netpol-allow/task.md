Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Namespace `${NS}` runs Pods `${BACKEND}` (nginx, behind Service `${BACKEND}`), `${CLIENT}` and `intruder`. A NetworkPolicy blocks all incoming traffic in the namespace.

Create a NetworkPolicy so that Pods labelled `role=${BACKEND}` accept TCP port `80` from Pods labelled `role=${CLIENT}`, and from nothing else.

Keep `default-deny-ingress` and do not change any Pod labels.
