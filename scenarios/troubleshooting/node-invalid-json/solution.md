## Solution

### Question 1: Unhealthy worker

This run's fault: **`${Q1_FAULT}`** on `${Q1_NODE}`.

<!-- fault Q1_FAULT=cni-conflist-typo -->
#### CNI conflist is present but invalid JSON (`cni-conflist-typo`)

A file still sits in `/etc/cni/net.d`, but it is truncated / invalid JSON (and names a bogus plugin): `python3 -m json.tool <file>` fails to parse it, and the runtime network never becomes ready, so the node turns `NotReady`. You do not have to write a conflist from scratch: every worker carries the same one, so copy it from the healthy worker — and looking around the broken node (`ls /root`) turns up a backup at `/root/cni-conflist.cka-bak`. Restore the conflist, then restart containerd and the kubelet.

On the broken worker:

```bash
f=$(ls /etc/cni/net.d/*.conflist 2>/dev/null | head -1)
[[ -f /root/cni-conflist.cka-bak ]] || { echo "missing CNI backup" >&2; exit 1; }
if [[ -n "$f" ]]; then cp -a /root/cni-conflist.cka-bak "$f"; else cp -a /root/cni-conflist.cka-bak /etc/cni/net.d/10-calico.conflist; fi
systemctl restart containerd
systemctl restart kubelet
```
<!-- /fault -->
