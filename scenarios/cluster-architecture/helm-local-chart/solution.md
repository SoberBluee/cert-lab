## Solution

Download and unpack the chart. `-d` is the directory it lands in:

```bash
helm pull lab/webapp --version 2.0.0 --untar -d /opt/course/helm/charts
ls /opt/course/helm/charts/webapp        # Chart.yaml  charts  templates  values.yaml
```

The defaults are in `values.yaml`, and the chart's own version is in `Chart.yaml`. Edit both, with vim or sed:

```bash
cd /opt/course/helm/charts/webapp
sed -i -E 's/^version:.*/version: 2.0.1/' Chart.yaml
sed -i -E 's/^replicaCount:.*/replicaCount: ${REPLICAS}/' values.yaml
vim values.yaml                          # under service:, set type: NodePort
```

`values.yaml` should now hold:

```yaml
replicaCount: ${REPLICAS}
service:
  type: NodePort
  port: 80
```

Check what the chart renders before you package it:

```bash
helm template check /opt/course/helm/charts/webapp | grep -E 'replicas:|type:'
#   replicas: ${REPLICAS}
#   type: NodePort
```

Package it. The file name comes from the chart's name and version, which is why the version had to change first:

```bash
helm package /opt/course/helm/charts/webapp -d /opt/course/helm
# Successfully packaged chart and saved it to: /opt/course/helm/webapp-2.0.1.tgz
```

Install from the file, with no `--set` and no `-f`:

```bash
helm install ${REL} /opt/course/helm/webapp-2.0.1.tgz -n ${NS} --create-namespace
helm -n ${NS} list                       # CHART webapp-2.0.1
helm -n ${NS} get values ${REL}          # USER-SUPPLIED VALUES: null
k -n ${NS} get deploy,svc
```

Changing the chart and passing values give the same Pods, but they are recorded differently. Values from `--set` or `-f` belong to the release and show in `helm get values`. Defaults belong to the chart, so every release installed from this package gets them.
