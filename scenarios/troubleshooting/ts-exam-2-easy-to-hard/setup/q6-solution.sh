#!/usr/bin/env bash
# Question 6: kubectl stopped working. Solution step on controlplane, applied by "cka verify".
set -euo pipefail

case "${Q6_FAULT}" in
  kubeconfig-server-port)
    sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /root/.kube/config
    grep -qE -- 'server: https://[^[:space:]]+:6443$' /root/.kube/config || { echo "could not modify /root/.kube/config" >&2; exit 1; }
    sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /home/ubuntu/.kube/config
    grep -qE -- 'server: https://[^[:space:]]+:6443$' /home/ubuntu/.kube/config || { echo "could not modify /home/ubuntu/.kube/config" >&2; exit 1; }
    ;;
  kubeconfig-wrong-ca)
    for f in /root/.kube/config /home/ubuntu/.kube/config; do
      kubectl config --kubeconfig "$f" set clusters.kubernetes.certificate-authority-data "$(base64 -w0 /etc/kubernetes/pki/ca.crt)" >/dev/null
    done
    ;;
  apiserver-client-ca)
    sed -i -E 's#^([[:space:]]*- --client-ca-file=/etc/kubernetes/pki/ca)\.cert$#\1.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --client-ca-file=/etc/kubernetes/pki/ca.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  apiserver-secure-port)
    sed -i -E 's#^([[:space:]]*- --secure-port=)6444$#\16443#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --secure-port=6443$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  apiserver-manifest-yaml)
    sed -i -E 's#^   image: (registry\.k8s\.io/kube-apiserver:)#    image: \1#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '^    image: registry.k8s.io/kube-apiserver:' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
esac

case "${Q6_FAULT}" in
  kubeconfig-server-port)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q6_NS}" rollout status deployment/web --timeout=300s
    ;;
  kubeconfig-wrong-ca)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q6_NS}" rollout status deployment/web --timeout=300s
    ;;
  apiserver-client-ca)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q6_NS}" rollout status deployment/web --timeout=300s
    ;;
  apiserver-secure-port)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q6_NS}" rollout status deployment/web --timeout=300s
    ;;
  apiserver-manifest-yaml)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q6_NS}" rollout status deployment/web --timeout=300s
    ;;
esac
