#!/usr/bin/env bash
set -euo pipefail

pki=/etc/kubernetes/pki
work="$(mktemp -d)"
mkdir -p "$work/new" /opt/course/certs
chown -R ubuntu:ubuntu /opt/course
: > "$work/index.txt"
echo 1000 > "$work/serial"
cat > "$work/ca.cnf" <<EOF
[ca]
default_ca = lab
[lab]
dir = $work
new_certs_dir = $work/new
database = $work/index.txt
serial = $work/serial
default_md = sha256
policy = any
x509_extensions = ext
unique_subject = no
[any]
commonName = supplied
[ext]
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = clientAuth
basicConstraints = critical,CA:FALSE
EOF

expired() {
  local name="$1" ca="$2" cn="$3"
  openssl req -new -key "$pki/$name.key" -subj "/CN=$cn" -out "$work/$name.csr"
  openssl ca -batch -config "$work/ca.cnf" -notext -cert "$pki/$ca.crt" -keyfile "$pki/$ca.key" \
    -in "$work/$name.csr" -out "$pki/$name.crt" -startdate 20250101000000Z -enddate 20260101000000Z >/dev/null 2>&1
  openssl x509 -checkend 0 -noout -in "$pki/$name.crt" >/dev/null && { echo "$name did not expire" >&2; exit 1; } || true
}
expired apiserver-kubelet-client ca kube-apiserver-kubelet-client
expired front-proxy-client front-proxy-ca front-proxy-client
rm -rf "$work"

(cd / && sha256sum "$pki/ca.crt" "$pki/front-proxy-ca.crt" "$pki/etcd/ca.crt" "$pki/apiserver.crt" "$pki/apiserver-etcd-client.crt") > /var/tmp/cka-certs.sha
chmod 644 /var/tmp/cka-certs.sha

# The API server only reads these files when it starts.
mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/kube-apiserver.yaml
timeout 60 bash -c 'while crictl ps --name kube-apiserver -q 2>/dev/null | grep -q .; do sleep 1; done'
mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/kube-apiserver.yaml
timeout 180 bash -c 'until kubectl get --raw=/readyz >/dev/null 2>&1; do sleep 2; done'

pod="$(kubectl -n kube-system get pods -l k8s-app=kube-proxy -o jsonpath='{.items[0].metadata.name}')"
for _ in $(seq 1 30); do
  out="$(kubectl -n kube-system logs "$pod" --tail=1 2>&1 || true)"
  [[ "$out" == *'logged in'* ]] && exit 0
  sleep 2
done
echo "kubectl logs still works" >&2
exit 1
