Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Namespace `${NS}` runs Pods `${CLIENT}` (label `role=${CLIENT}`), `${DB}` (`role=${DB}`, TCP `${DB_PORT}`) and `cache` (`role=cache`), with Services `${DB}` and `cache`.

Create a NetworkPolicy `${CLIENT}-egress` so that `${CLIENT}` can only open connections to `role=${DB}` Pods on TCP `${DB_PORT}`, and to cluster DNS on port `53` (UDP and TCP), so the Service name `${DB}` keeps working. Everything else from `${CLIENT}` must be blocked.

The egress of every other Pod in the namespace must stay as open as it is now. Do not delete any existing NetworkPolicy.
