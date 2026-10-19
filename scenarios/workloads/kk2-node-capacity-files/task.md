Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Find the CPU and memory **Capacity** of node `worker-1` and save them on `controlplane`:

- `/opt/course/worker-1-cpu.txt`
- `/opt/course/worker-1-memory.txt`

Each file must contain a single line in this exact form:

```text
cpu: <value>
```

```text
memory: <value>
```

Use the same values and units `kubectl` reports under Capacity.
