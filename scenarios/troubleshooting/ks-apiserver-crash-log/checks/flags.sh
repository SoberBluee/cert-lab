#!/usr/bin/env bash
# Prints "ok" when the startup flags of the kube-apiserver are back to the kubeadm defaults.
m=/etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --authorization-mode=Node,RBAC$' $m \
  && grep -qE -- '- --enable-admission-plugins=NodeRestriction$' $m \
  && grep -qE -- '- --enable-bootstrap-token-auth=true$' $m \
  && echo ok || echo wrong
