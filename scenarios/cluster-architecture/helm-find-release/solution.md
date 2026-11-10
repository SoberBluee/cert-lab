## Solution

List the releases of every namespace, with their chart versions:

```bash
helm list -A
# NAME       NAMESPACE   CHART          APP VERSION
# docs       docs-site   webapp-1.0.0   1.26-alpine
# frontend   web-shared  webapp-2.0.0   1.28-alpine
# status     ops         webapp-1.1.0   1.27-alpine
# ${T_REL}   ${T_NS}     webapp-1.0.0   1.26-alpine
```

`APP VERSION` is the chart's default, not what a release runs, so it does not show an overridden tag. `frontend` really does run `1.28-alpine`, but from chart `2.0.0`. Read the manifests of the two `1.0.0` releases:

```bash
helm -n docs-site get manifest docs | grep image:        # nginx:1.26-alpine
helm -n ${T_NS} get manifest ${T_REL} | grep image:      # nginx:1.28-alpine
echo ${T_NS}/${T_REL} > /opt/course/helm/release.txt
```

`helm get values` shows only the values set for this release. `-o yaml` leaves out the `USER-SUPPLIED VALUES:` header line, so the file is plain YAML:

```bash
helm -n ${T_NS} get values ${T_REL} -o yaml > /opt/course/helm/values.yaml
cat /opt/course/helm/values.yaml
# image:
#   tag: 1.28-alpine
# podAnnotations:
#   owner: ${OWNER}
# service:
#   type: NodePort
```

Scale through Helm. `--reuse-values` keeps those values, and `--version 1.0.0` keeps the chart: without it, `helm upgrade` takes the newest version, `2.0.0`.

```bash
helm -n ${T_NS} upgrade ${T_REL} lab/webapp --version 1.0.0 --reuse-values --set replicaCount=${REPLICAS}
helm -n ${T_NS} get values ${T_REL}
k -n ${T_NS} get deploy
```

`kubectl scale` would change the Deployment, but not the release: the next `helm upgrade` would put the old replica count back.
