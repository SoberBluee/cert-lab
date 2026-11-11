export type TrackId = 'create' | 'troubleshoot' | 'cluster';

/** `short` is the one line a list shows; `blurb` the whole story, for a tooltip. */
export const TRACKS: { id: TrackId; name: string; short: string; blurb: string; soon?: boolean }[] = [
  {
    id: 'create',
    name: 'Create',
    short: 'Build a resource, add requirements, then follow-up steps',
    blurb: 'Pick a resource (Deployment, Pod, RBAC, CronJob), add requirements like a Service or a sidecar, then follow-up steps like a rolling update.',
  },
  {
    id: 'troubleshoot',
    name: 'Troubleshoot',
    short: 'Pick a category; a hidden fault is injected at every start',
    blurb:
      'Pick a category (Pods, Services, Ingress and HTTPRoute, DNS, Scheduling, Nodes, Storage). A random fault is injected at every start and kept hidden, even from you.',
  },
  {
    id: 'cluster',
    name: 'Cluster',
    short: 'etcd, certificates, installs and control plane repairs',
    blurb:
      'Administer the cluster: back up or restore etcd, work with certificates, install a cluster from scratch, or repair a hidden fault in the control plane.',
  },
];
