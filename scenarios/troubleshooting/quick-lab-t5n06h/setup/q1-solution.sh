#!/usr/bin/env bash
# Question 1: Control plane after maintenance. Solution step on controlplane, applied by "cka verify".
set -euo pipefail

case "${Q1_FAULT}" in
  etcd-cert-path)
    sed -i -E 's#^([[:space:]]*- --cert-file=/etc/kubernetes/pki/etcd/server)\.cert$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    ;;
  etcd-key-path)
    sed -i -E 's#^([[:space:]]*- --key-file=/etc/kubernetes/pki/etcd/server)\.pem$#\1.key#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --key-file=/etc/kubernetes/pki/etcd/server.key$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    ;;
  etcd-trusted-ca-path)
    sed -i -E 's#^([[:space:]]*- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca)\.pem$#\1.crt#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    ;;
  etcd-client-urls)
    sed -i -E '/--listen-client-urls=/s/:2378/:2379/g' /etc/kubernetes/manifests/etcd.yaml
    sed -i -E '/--advertise-client-urls=/s/:2378/:2379/g' /etc/kubernetes/manifests/etcd.yaml
    ;;
  etcd-data-dir)
    sed -i -E 's#^([[:space:]]*- --data-dir=)/var/lib/etcd-broken$#\1/var/lib/etcd#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --data-dir=/var/lib/etcd$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    ;;
  etcd-image-tag)
    sed -i -E "s#etcd:v0\.0\.0#$(cat "/var/tmp/cka-q1.etcd-image")#" /etc/kubernetes/manifests/etcd.yaml
    grep -q 'etcd:v0\.0\.0' /etc/kubernetes/manifests/etcd.yaml && { echo "could not restore the etcd image" >&2; exit 1; }
    ;;
  etcd-peer-urls)
    sed -i -E '/--listen-peer-urls=/s/:2381/:2380/g' /etc/kubernetes/manifests/etcd.yaml
    sed -i -E '/--initial-advertise-peer-urls=/s/:2381/:2380/g' /etc/kubernetes/manifests/etcd.yaml
    ;;
esac

case "${Q1_FAULT}" in
  etcd-cert-path)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q1_NS}" rollout status deployment/web --timeout=300s
    ;;
  etcd-key-path)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q1_NS}" rollout status deployment/web --timeout=300s
    ;;
  etcd-trusted-ca-path)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q1_NS}" rollout status deployment/web --timeout=300s
    ;;
  etcd-client-urls)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q1_NS}" rollout status deployment/web --timeout=300s
    ;;
  etcd-data-dir)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q1_NS}" rollout status deployment/web --timeout=300s
    ;;
  etcd-image-tag)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q1_NS}" rollout status deployment/web --timeout=300s
    ;;
  etcd-peer-urls)
    for _ in $(seq 1 240); do
      [[ "$(curl -sk --max-time 3 https://127.0.0.1:6443/readyz 2>/dev/null || true)" == ok ]] && break
      sleep 2
    done
    for _ in $(seq 1 120); do
      [[ "$({ kubectl get node controlplane -o jsonpath='controlplane={.status.conditions[?(@.type=="Ready")].status}{"\n"}'; kubectl -n kube-system get pods -l tier=control-plane -o jsonpath='{range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | sort; } | xargs 2>/dev/null || true)" == "controlplane=True etcd-controlplane=True kube-apiserver-controlplane=True kube-controller-manager-controlplane=True kube-scheduler-controlplane=True" ]] && break
      sleep 3
    done
    kubectl -n "${Q1_NS}" rollout status deployment/web --timeout=300s
    ;;
esac
