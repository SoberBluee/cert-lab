## Solution

### Question 1: Cluster certificates

```bash
mkdir -p "$(dirname "${Q1_EXPIRY}")"
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate | cut -d= -f2 > "${Q1_EXPIRY}"
```
