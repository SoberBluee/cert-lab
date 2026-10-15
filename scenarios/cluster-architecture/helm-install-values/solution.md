## Solution

```bash
helm repo add lab http://controlplane:8879
helm repo update
helm repo list

helm search repo lab/webapp --versions > /opt/course/helm/versions.txt
cat /opt/course/helm/versions.txt
# NAME        CHART VERSION  APP VERSION  DESCRIPTION
# lab/webapp  2.0.0          1.28-alpine  ...
# lab/webapp  1.1.0          1.27-alpine  ...
# lab/webapp  1.0.0          1.26-alpine  ...
```

Look up which values the chart accepts before you guess:

```bash
helm show values lab/webapp --version 1.1.0 | grep -nE '^replicaCount|^service:' -A3
```

```bash
helm install ${REL} lab/webapp --version 1.1.0 \
  -n ${NS} --create-namespace \
  --set replicaCount=${REPLICAS} \
  --set service.type=NodePort

helm -n ${NS} list
helm -n ${NS} get values ${REL}
k -n ${NS} get deploy,svc
```

Without `--version`, Helm installs the newest version (`2.0.0`). Without `-n`, the release lands in `default`.
