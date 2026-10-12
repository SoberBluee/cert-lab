export type TrackId = 'create' | 'troubleshoot' | 'cluster';

export const TRACKS: { id: TrackId; name: string; blurb: string; soon?: boolean }[] = [
  {
    id: 'create',
    name: 'Create',
    blurb: 'Pick a resource (Deployment, Pod, RBAC, CronJob), add requirements like a Service or a sidecar, then follow-up steps like a rolling update.',
  },
  {
    id: 'troubleshoot',
    name: 'Troubleshoot',
    blurb:
      'Pick a category (Pods, Services, Ingress and HTTPRoute, DNS, Scheduling, Nodes, Storage). A random fault is injected at every start and kept hidden, even from you.',
  },
  {
    id: 'cluster',
    name: 'Cluster',
    blurb:
      'Administer the cluster: back up or restore etcd, work with certificates, install a cluster from scratch, or repair a hidden fault in the control plane.',
  },
];
