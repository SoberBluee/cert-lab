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
    blurb: 'Pick a category (Pods, Services, Nodes, Storage). A random fault is injected at every start and kept hidden, even from you.',
  },
  {
    id: 'cluster',
    name: 'Cluster',
    blurb: 'Install and repair the cluster itself: kubeadm init and join, upgrades, etcd backup and restore, control-plane faults.',
    soon: true,
  },
];
