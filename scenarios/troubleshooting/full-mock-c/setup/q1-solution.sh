#!/usr/bin/env bash
# Question 1: Control plane after maintenance. Solution step on controlplane, applied by "cka verify".
set -euo pipefail

(
case "${Q1_FAULT}" in
  scheduler-missing-file)
    case "${Q1_SCHEDULER_FILE}" in
      kubeconfig)
        sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml
        grep -qE -- '- --kubeconfig=/etc/kubernetes/scheduler.conf$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
        ;;
      config)
        sed -i -E '\#^[[:space:]]*- --config=/etc/kubernetes/sched-config.yaml$#d' /etc/kubernetes/manifests/kube-scheduler.yaml
        ! grep -qE -- '- --config=' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not remove scheduler --config" >&2; exit 1; }
        ;;
    esac
    ;;
  controller-manager-missing-file)
    case "${Q1_CM_FILE}" in
      kubeconfig)
        sed -i -E 's#^([[:space:]]*- --kubeconfig=)/etc/kubernetes/controller-manager.config$#\1/etc/kubernetes/controller-manager.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
        grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
        ;;
      service-account-private-key-file)
        sed -i -E 's#^([[:space:]]*- --service-account-private-key-file=)/etc/kubernetes/pki/sa.pem$#\1/etc/kubernetes/pki/sa.key#' /etc/kubernetes/manifests/kube-controller-manager.yaml
        grep -qE -- '- --service-account-private-key-file=/etc/kubernetes/pki/sa.key$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
        ;;
      *) echo "unknown flag ${Q1_CM_FILE}" >&2; exit 1 ;;
    esac
    ;;
  scheduler-command)
    sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
    grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
    ;;
  scheduler-image-tag)
    sed -i -E "s#kube-scheduler:v0\.0\.0#$(cat "/var/tmp/cka-q1.scheduler-image")#" /etc/kubernetes/manifests/kube-scheduler.yaml
    grep -q 'kube-scheduler:v0\.0\.0' /etc/kubernetes/manifests/kube-scheduler.yaml && { echo "could not restore the scheduler image" >&2; exit 1; }
    ;;
  scheduler-manifest-removed)
    mv /var/tmp/cka-kube-scheduler.yaml /etc/kubernetes/manifests/kube-scheduler.yaml
    [[ -f /etc/kubernetes/manifests/kube-scheduler.yaml ]]
    ;;
  scheduler-manifest-yaml)
    sed -i -E 's#^   image: (registry\.k8s\.io/kube-scheduler:)#    image: \1#' /etc/kubernetes/manifests/kube-scheduler.yaml
    grep -qE -- '^    image: registry.k8s.io/kube-scheduler:' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
    ;;
  controller-manager-command)
    sed -i -E 's#^([[:space:]]*)- kube-controller-managr$#\1- kube-controller-manager#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- kube-controller-manager$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
esac
)

(
case "${Q1_FAULT_2}" in
  apiserver-missing-file)
    case "${Q1_APISERVER_FILE}" in
      etcd-certfile)
        sed -i -E 's#^([[:space:]]*- --etcd-certfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.crt$#\1/etc/kubernetes/pki/apiserver-etcd-client.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
        grep -qE -- '- --etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
        ;;
      etcd-keyfile)
        sed -i -E 's#^([[:space:]]*- --etcd-keyfile=)/etc/kubernetes/pki/etcd/apiserver-etcd-client.key$#\1/etc/kubernetes/pki/apiserver-etcd-client.key#' /etc/kubernetes/manifests/kube-apiserver.yaml
        grep -qE -- '- --etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
        ;;
      tls-private-key-file)
        sed -i -E 's#^([[:space:]]*- --tls-private-key-file=)/etc/kubernetes/pki/apiserver.pem$#\1/etc/kubernetes/pki/apiserver.key#' /etc/kubernetes/manifests/kube-apiserver.yaml
        grep -qE -- '- --tls-private-key-file=/etc/kubernetes/pki/apiserver.key$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
        ;;
      service-account-key-file)
        sed -i -E 's#^([[:space:]]*- --service-account-key-file=)/etc/kubernetes/pki/sa.pem$#\1/etc/kubernetes/pki/sa.pub#' /etc/kubernetes/manifests/kube-apiserver.yaml
        grep -qE -- '- --service-account-key-file=/etc/kubernetes/pki/sa.pub$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
        ;;
      *) echo "unknown flag ${Q1_APISERVER_FILE}" >&2; exit 1 ;;
    esac
    ;;
  etcd-missing-file)
    case "${Q1_ETCD_FILE}" in
      cert-file)
        sed -i -E 's#^([[:space:]]*- --cert-file=)/etc/kubernetes/pki/etcd/server.cert$#\1/etc/kubernetes/pki/etcd/server.crt#' /etc/kubernetes/manifests/etcd.yaml
        grep -qE -- '- --cert-file=/etc/kubernetes/pki/etcd/server.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
        ;;
      key-file)
        sed -i -E 's#^([[:space:]]*- --key-file=)/etc/kubernetes/pki/etcd/server.pem$#\1/etc/kubernetes/pki/etcd/server.key#' /etc/kubernetes/manifests/etcd.yaml
        grep -qE -- '- --key-file=/etc/kubernetes/pki/etcd/server.key$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
        ;;
      trusted-ca-file)
        sed -i -E 's#^([[:space:]]*- --trusted-ca-file=)/etc/kubernetes/pki/etcd/ca.pem$#\1/etc/kubernetes/pki/etcd/ca.crt#' /etc/kubernetes/manifests/etcd.yaml
        grep -qE -- '- --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
        ;;
      *) echo "unknown flag ${Q1_ETCD_FILE}" >&2; exit 1 ;;
    esac
    ;;
  apiserver-authz-mode)
    sed -i -E 's#^([[:space:]]*- --authorization-mode=)Node,RABC$#\1Node,RBAC#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --authorization-mode=Node,RBAC$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  apiserver-probe-port)
    orig="$(cat "/var/tmp/cka-q1.probe-port")"
    for probe in livenessProbe startupProbe; do
      sed -i -E '/^    '"$probe"':$/,/^    [a-zA-Z]/ s/^([[:space:]]+port: )6444$/\1'"$orig"'/' /etc/kubernetes/manifests/kube-apiserver.yaml
    done
    ! grep -qE '^[[:space:]]+port: 6444$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not restore the probes" >&2; exit 1; }
    ;;
  apiserver-manifest-copy)
    rm -f /etc/kubernetes/manifests/kube-apiserver-new.yaml
    ;;
  etcd-restore-half-done)
    old="$(crictl ps --name '^etcd$' -q | head -1)"
    sed -i -E 's#^([[:space:]]*- --data-dir=)/var/lib/etcd-restore$#\1/var/lib/etcd#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- '- --data-dir=/var/lib/etcd$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    sed -i -E 's#^([[:space:]]*path: )/var/lib/etcd$#\1/var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml
    grep -qE -- 'path: /var/lib/etcd-restore$' /etc/kubernetes/manifests/etcd.yaml || { echo "could not modify /etc/kubernetes/manifests/etcd.yaml" >&2; exit 1; }
    for _ in $(seq 1 60); do
      new="$(crictl ps --name '^etcd$' -q | head -1)"
      [[ -n "$new" && "$new" != "$old" ]] && break
      sleep 2
    done
    crictl ps --name kube-apiserver -q | xargs -r crictl stop
    ;;
  apiserver-etcd-port)
    sed -i -E 's#^([[:space:]]*- --etcd-servers=https://127.0.0.1):2380$#\1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --etcd-servers=https://127.0.0.1:2379$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  apiserver-etcd-flags)
    sed -i -E 's#^([[:space:]]*- --)etcd-server=#\1etcd-servers=#' /etc/kubernetes/manifests/kube-apiserver.yaml
    sed -i -E 's#^([[:space:]]*- --etcd-servers=)http://127.0.0.1:2379$#\1https://127.0.0.1:2379#' /etc/kubernetes/manifests/kube-apiserver.yaml
    sed -i -E 's#^([[:space:]]*- --etcd-cafile=)/etc/kubernetes/pki/ca.crt$#\1/etc/kubernetes/pki/etcd/ca.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    ;;
  kubelet-static-pod-path)
    sed -i -E 's#^staticPodPath: /etc/kubernetes/manifest$#staticPodPath: /etc/kubernetes/manifests#' /var/lib/kubelet/config.yaml
    grep -qE -- '^staticPodPath: /etc/kubernetes/manifests$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
    systemctl restart kubelet
    ;;
  apiserver-admission-plugin)
    sed -i -E 's#^([[:space:]]*- --enable-admission-plugins=[^[:space:]]+),PodSecurityPolicy$#\1#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --enable-admission-plugins=[^,[:space:]]+(,[^,[:space:]]+)*$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  apiserver-manifest-removed)
    mv /var/tmp/cka-kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
    [[ -f /etc/kubernetes/manifests/kube-apiserver.yaml ]]
    ;;
  etcd-client-urls)
    sed -i -E '/--listen-client-urls=/s/:2378/:2379/g' /etc/kubernetes/manifests/etcd.yaml
    sed -i -E '/--advertise-client-urls=/s/:2378/:2379/g' /etc/kubernetes/manifests/etcd.yaml
    ;;
  etcd-image-tag)
    sed -i -E "s#etcd:v0\.0\.0#$(cat "/var/tmp/cka-q1.etcd-image")#" /etc/kubernetes/manifests/etcd.yaml
    grep -q 'etcd:v0\.0\.0' /etc/kubernetes/manifests/etcd.yaml && { echo "could not restore the etcd image" >&2; exit 1; }
    ;;
  apiserver-advertise-address)
    addr=$(cat "/var/tmp/cka-q1.advertise")
    sed -i -E 's#^([[:space:]]*- --advertise-address=).*$#\1'"$addr"'#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --advertise-address='"$addr"'$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not restore advertise-address" >&2; exit 1; }
    ;;
esac
)

(
case "${Q1_FAULT}" in
  scheduler-missing-file)
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
  controller-manager-missing-file)
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
  scheduler-command)
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
  scheduler-image-tag)
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
  scheduler-manifest-removed)
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
  scheduler-manifest-yaml)
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
  controller-manager-command)
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
)

(
case "${Q1_FAULT_2}" in
  apiserver-missing-file)
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
  etcd-missing-file)
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
  apiserver-authz-mode)
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
  apiserver-probe-port)
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
  apiserver-manifest-copy)
    for _ in $(seq 1 60); do
      kubectl -n kube-system get pod kube-apiserver-new-controlplane >/dev/null 2>&1 || break
      sleep 3
    done
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
  etcd-restore-half-done)
    for _ in $(seq 1 120); do
      kubectl --kubeconfig "$( [[ -f /etc/kubernetes/super-admin.conf ]] && echo /etc/kubernetes/super-admin.conf || echo /etc/kubernetes/admin.conf )" get namespace "${Q1_NS}" >/dev/null 2>&1 && break
      sleep 3
    done
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
  apiserver-etcd-port)
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
  apiserver-etcd-flags)
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
  kubelet-static-pod-path)
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
  apiserver-admission-plugin)
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
  apiserver-manifest-removed)
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
  apiserver-advertise-address)
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
)
