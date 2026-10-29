#!/usr/bin/env bash
# Question 3: Worker after a configuration change. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q3_NODE}" ]] || exit 0

case "${Q3_FAULT}" in
  kubelet-client-ca)
    sed -i -E 's#^([[:space:]]*clientCAFile: /etc/kubernetes/pki/)ca\.pem$#\1ca.crt#' /var/lib/kubelet/config.yaml
    grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca.crt$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
    systemctl restart kubelet
    ;;
  runtime-endpoint)
    sed -i -E 's#^containerRuntimeEndpoint: unix:///var/run/crio/crio\.sock$#containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock#' /var/lib/kubelet/config.yaml
    grep -qE -- '^containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
    systemctl restart kubelet
    ;;
  kubelet-config-flag)
    dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
    sed -i -E 's#--config=/var/lib/kubelet/kubelet-config\.yaml#--config=/var/lib/kubelet/config.yaml#' "$dropin"
    grep -qE -- '--config=/var/lib/kubelet/config.yaml' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
    systemctl daemon-reload
    systemctl restart kubelet
    ;;
  kubelet-kubeconfig-flag)
    dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
    sed -i -E 's#--kubeconfig=/etc/kubernetes/kubelet\.config#--kubeconfig=/etc/kubernetes/kubelet.conf#' "$dropin"
    grep -qE -- '--kubeconfig=/etc/kubernetes/kubelet.conf' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
    systemctl daemon-reload
    systemctl restart kubelet
    ;;
  kubelet-serving-cert)
    sed -i -E '/^tls(CertFile|PrivateKeyFile): /d' /var/lib/kubelet/config.yaml
    systemctl restart kubelet
    ;;
  kubelet-eviction-hard)
    if [[ -f /var/lib/kubelet/config.yaml.cka-bak ]]; then cp -a /var/lib/kubelet/config.yaml.cka-bak /var/lib/kubelet/config.yaml; else
      sed -i '/^evictionHard:/,/^[^[:space:]]/{ /^evictionHard:/d; /^[[:space:]]/d; }' /var/lib/kubelet/config.yaml || true
      sed -i '/memory.available: "99%"/d' /var/lib/kubelet/config.yaml || true
    fi
    systemctl restart kubelet
    ;;
  kubelet-cgroup-driver)
    sed -i -E 's#^([[:space:]]*SystemdCgroup = )"invalid"[[:space:]]*$#\1true#' /etc/containerd/config.toml
    grep -qE -- '^[[:space:]]*SystemdCgroup = true$' /etc/containerd/config.toml || { echo "could not modify /etc/containerd/config.toml" >&2; exit 1; }
    systemctl restart containerd
    systemctl restart kubelet
    ;;
esac
