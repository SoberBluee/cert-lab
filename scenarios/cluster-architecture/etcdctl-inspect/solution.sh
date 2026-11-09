#!/usr/bin/env bash
set -euo pipefail

e() { etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key "$@"; }
out=/opt/course/etcd

# Question 1
e member list | cut -d, -f1 > "$out/member-id.txt"
e endpoint status | cut -d, -f3 | tr -d ' ' > "$out/version.txt"
e get /registry/namespaces --prefix --keys-only | grep -c registry > "$out/namespace-keys.txt"

# Question 2
key="/registry/secrets/${Q2_NS}/${Q2_SECRET}"
echo "$key" > "$out/secret-key.txt"
value="$(kubectl -n "${Q2_NS}" get secret "${Q2_SECRET}" -o jsonpath='{.data.apikey}' | base64 -d)"
dump="$(e get "$key" | tr -d '\000')"
if [[ "$dump" == *"$value"* ]]; then echo plain > "$out/secret-storage.txt"; else echo encrypted > "$out/secret-storage.txt"; fi
