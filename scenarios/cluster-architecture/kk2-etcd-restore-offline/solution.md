# Restore an etcd snapshot offline

```bash
sudo etcdutl snapshot restore ${SNAPSHOT} --data-dir ${DATADIR}
```

Do not retarget the live etcd Pod.
