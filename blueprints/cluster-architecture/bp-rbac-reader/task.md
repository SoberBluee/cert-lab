Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Create a ServiceAccount `${SA}` in namespace `${NS}` that can `get`, `list` and `watch` **${RESOURCE}** in `${NS}`.

It must not be able to change ${RESOURCE}, read anything in other namespaces, or read Secrets.
