## Solution

### Question 1: Add HTTPS to ${Q1_SUB}.${Q1_NS}.lab

Clients check the subject alternative name, not the CN, so set it with `-addext`.

```bash
host="${Q1_SUB}.${Q1_NS}.lab"
dir="/opt/course/tls/${Q1_NS}"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$dir/tls.key" -out "$dir/tls.crt" -days 90 -subj "/CN=$host" -addext "subjectAltName=DNS:$host"
kubectl -n "${Q1_NS}" create secret tls web-tls --cert="$dir/tls.crt" --key="$dir/tls.key"
kubectl -n "${Q1_NS}" patch ingress web --type=merge -p '{"spec":{"tls":[{"hosts":["'"$host"'"],"secretName":"web-tls"}]}}'
```

The `hosts` entry under `spec.tls` must match the host in the rule, or the controller will not use the Secret for that host.

### Question 2: ${Q2_SUB}.${Q2_NS}.lab serves the wrong certificate

An Ingress can only use a Secret in its own namespace, and `secretName` has no namespace field. `site-tls` exists only in `cert-store`, so the controller logs `secret ${Q2_NS}/site-tls does not exist`. It keeps serving the site but falls back to its default certificate, which is why nothing looks broken over `curl -k`. Copy the Secret into `${Q2_NS}`, leaving the original alone.

```bash
kubectl -n cert-store get secret site-tls -o json |
  jq --arg ns "${Q2_NS}" '{apiVersion, kind, type, data, metadata: {name: .metadata.name, namespace: $ns}}' |
  kubectl apply -f -
```
