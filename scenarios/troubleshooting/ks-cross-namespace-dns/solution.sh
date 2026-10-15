#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root.
# Fixes whichever fault each layer rolled by patching only the broken field.
set -euo pipefail

case "$EGRESS_FAULT" in
  no-dns)
    kubectl -n "$CLIENT_NS" patch networkpolicy default-deny-egress --type=json -p '[{"op":"add","path":"/spec/egress/-","value":{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"kube-system"}},"podSelector":{"matchLabels":{"k8s-app":"kube-dns"}}}],"ports":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}}]'
    ;;
  dns-port)
    kubectl -n "$CLIENT_NS" patch networkpolicy default-deny-egress --type=json -p '[{"op":"replace","path":"/spec/egress/1/ports","value":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]'
    ;;
  api-port)
    kubectl -n "$CLIENT_NS" patch networkpolicy default-deny-egress --type=json -p '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"TCP","port":80}]}]'
    ;;
esac

case "$INGRESS_FAULT" in
  ns-label)
    kubectl -n "$API_NS" patch networkpolicy api-ingress --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/namespaceSelector/matchLabels","value":{"team":"frontend"}}]'
    ;;
  pod-selector)
    kubectl -n "$API_NS" patch networkpolicy api-ingress --type=json -p '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"app":"frontend"}}]'
    ;;
  port)
    kubectl -n "$API_NS" patch networkpolicy api-ingress --type=json -p '[{"op":"replace","path":"/spec/ingress/0/ports","value":[{"protocol":"TCP","port":80}]}]'
    ;;
esac

case "$SERVICE_FAULT" in
  target-port | port-name)
    kubectl -n "$API_NS" patch service api --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":80}]'
    ;;
  selector)
    kubectl -n "$API_NS" patch service api --type=json -p '[{"op":"replace","path":"/spec/selector","value":{"app":"api"}}]'
    ;;
esac

for _ in $(seq 1 30); do
  kubectl -n "$CLIENT_NS" exec deploy/frontend -- wget -qO- -T 4 "http://api.${API_NS}.svc.cluster.local" 2>/dev/null | grep -q "api ok" && exit 0
  sleep 3
done
echo "frontend still cannot reach the API" >&2
exit 1
