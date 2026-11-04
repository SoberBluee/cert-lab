## Solution

### Question 1: Plan a cluster upgrade

```bash
[[ -f /opt/cka/versions.env ]] || { echo "these lab images have no upgrade packages: run ./cka images extras (or rebuild the images)" >&2; exit 1; }
. /opt/cka/versions.env
export DEBIAN_FRONTEND=noninteractive
apt-mark unhold kubeadm >/dev/null
apt-get install -y -q "kubeadm=$CURRENT_PKG" >/dev/null
apt-mark hold kubeadm >/dev/null
kubeadm upgrade plan 2>/dev/null | grep -oE 'kubeadm upgrade apply v[0-9.]+' | head -1 | awk '{print $4}' > /opt/course/upgrade/target.txt
kubectl version -o json | jq -r .serverVersion.gitVersion > /opt/course/upgrade/current.txt
```
