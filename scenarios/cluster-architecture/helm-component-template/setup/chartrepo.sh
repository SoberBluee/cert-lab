#!/usr/bin/env bash
# Local Helm chart repository on controlplane, so Helm questions need no internet.
# Charts: webapp 1.0.0 / 1.1.0 / 2.0.0 (nginx), node-agent 0.1.0 / 0.2.0 (busybox DaemonSet).
# Served at http://controlplane:8879 by a transient systemd unit. Keep this file free of
# dollar-brace expansions: packages/core/src/recipes/create/helm.ts embeds the same script.
set -euo pipefail
export HOME=/root

command -v helm >/dev/null || { echo "helm is not installed on controlplane; rebuild the images" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is missing on controlplane" >&2; exit 1; }

# Several questions of one lab may run this at the same time; the first one builds the repository.
exec 9>/run/cka-chartrepo.lock
flock 9
if curl -sf http://controlplane:8879/index.yaml 2>/dev/null | grep -q 'node-agent-0.2.0.tgz'; then
  exit 0
fi

systemctl stop cka-chartrepo 2>/dev/null || true
systemctl reset-failed cka-chartrepo 2>/dev/null || true
rm -rf /opt/charts
mkdir -p /opt/charts/src /opt/charts/repo
cd /opt/charts/src

webapp() {
  local version=$1 app=$2 replicas=$3
  rm -rf webapp
  helm create webapp >/dev/null
  sed -i -E "s/^version:.*/version: $version/; s/^appVersion:.*/appVersion: \"$app\"/; s/^description:.*/description: Demo web app served by nginx/" webapp/Chart.yaml
  sed -i -E "s/^replicaCount:.*/replicaCount: $replicas/" webapp/values.yaml
  grep -q "^version: $version$" webapp/Chart.yaml || { echo "could not set the webapp chart version" >&2; exit 1; }
  grep -q "^replicaCount: $replicas$" webapp/values.yaml || { echo "could not set the webapp replicaCount" >&2; exit 1; }
  helm package webapp -d /opt/charts/repo >/dev/null
}
webapp 1.0.0 1.26-alpine 1
webapp 1.1.0 1.27-alpine 1
webapp 2.0.0 1.28-alpine 2

agent() {
  local version=$1
  rm -rf node-agent
  mkdir -p node-agent/templates
  cat > node-agent/Chart.yaml <<EOF
apiVersion: v2
name: node-agent
description: Collects node information on every node
type: application
version: $version
appVersion: "1.36"
EOF
  cat > node-agent/values.yaml <<'EOF'
image:
  repository: busybox
  tag: "1.36"
interval: 30
logLevel: info
tolerations: []
resources:
  requests:
    cpu: 10m
    memory: 16Mi
EOF
  cat > node-agent/templates/daemonset.yaml <<'EOF'
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: {{ .Release.Name }}
  labels:
    app.kubernetes.io/name: node-agent
    app.kubernetes.io/instance: {{ .Release.Name }}
    helm.sh/chart: node-agent-{{ .Chart.Version }}
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: node-agent
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: node-agent
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: agent
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: [sh, -c, "while true; do echo level={{ .Values.logLevel }} node=$NODE_NAME; sleep {{ .Values.interval }}; done"]
          env:
            - name: NODE_NAME
              valueFrom: { fieldRef: { fieldPath: spec.nodeName } }
          resources: {{- toYaml .Values.resources | nindent 12 }}
      {{- with .Values.tolerations }}
      tolerations: {{- toYaml . | nindent 8 }}
      {{- end }}
EOF
  helm package node-agent -d /opt/charts/repo >/dev/null
}
agent 0.1.0
agent 0.2.0

helm repo index /opt/charts/repo --url http://controlplane:8879
systemd-run --unit cka-chartrepo --collect python3 -m http.server 8879 --directory /opt/charts/repo >/dev/null
for _ in $(seq 1 30); do
  curl -sf http://controlplane:8879/index.yaml >/dev/null && break
  sleep 1
done
curl -sf http://controlplane:8879/index.yaml | grep -q 'webapp-2.0.0.tgz' || { echo "the chart repository did not come up" >&2; exit 1; }

# Fresh Helm state: no repositories for root or ubuntu, so learners add them themselves.
rm -rf /root/.config/helm/repositories.yaml /root/.cache/helm/repository
rm -rf /home/ubuntu/.config/helm/repositories.yaml /home/ubuntu/.cache/helm/repository
