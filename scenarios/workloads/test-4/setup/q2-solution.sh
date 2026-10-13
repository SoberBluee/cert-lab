#!/usr/bin/env bash
# Question 2: Control plane after maintenance. Solution step on controlplane, applied by "cka verify".
set -euo pipefail

case "${Q2_FAULT}" in
  apiserver-etcd-port)
    sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  apiserver-etcd-certfile)
    sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  etcd-cert-path)
    sed -i -E 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\.cert$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    ;;
  scheduler-command)
    sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
    grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
    ;;
  controller-manager-kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/controller-manager)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  kubelet-client-cert)
    sed -i -E 's#^([[:space:]]*client-certificate: /var/lib/kubelet/pki/)kubelet-client.pem$#\1kubelet-client-current.pem#' /etc/kubernetes/kubelet.conf
    grep -qE -- 'client-certificate: /var/lib/kubelet/pki/kubelet-client-current.pem$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
    systemctl restart kubelet
    ;;
esac

case "${Q2_FAULT}" in
  apiserver-etcd-port)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$(kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort | xargs 2>/dev/null || true)" == "etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q2_NS}" rollout status deployment/web --timeout=300s
    ;;
  apiserver-etcd-certfile)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$(kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort | xargs 2>/dev/null || true)" == "etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q2_NS}" rollout status deployment/web --timeout=300s
    ;;
  etcd-cert-path)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$(kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort | xargs 2>/dev/null || true)" == "etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q2_NS}" rollout status deployment/web --timeout=300s
    ;;
  scheduler-command)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$(kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort | xargs 2>/dev/null || true)" == "etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q2_NS}" rollout status deployment/web --timeout=300s
    ;;
  controller-manager-kubeconfig)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$(kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort | xargs 2>/dev/null || true)" == "etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q2_NS}" rollout status deployment/web --timeout=300s
    ;;
  kubelet-client-cert)
    for _ in $(seq 1 90); do
      [[ "$(kubectl get node "controlplane" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')" == True ]] && break
      sleep 2
    done
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$(kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort | xargs 2>/dev/null || true)" == "etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q2_NS}" rollout status deployment/web --timeout=300s
    ;;
esac
