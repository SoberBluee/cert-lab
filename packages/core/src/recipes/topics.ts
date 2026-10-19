import type { LabTopic } from '@cka/schema';
import { BUILDERS } from './create';
import { CATEGORIES, faultList } from './troubleshoot';

const faultsStarting = (categoryId: string, prefix: string): string[] => {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) throw new Error(`No fault category "${categoryId}".`);
  const ids = faultList(category).map((f) => f.id).filter((id) => id.startsWith(prefix));
  if (!ids.length) throw new Error(`Category "${categoryId}" has no fault starting with "${prefix}".`);
  return ids;
};

const create = (id: string, label: string, builderId: string, addons?: string[]): LabTopic => ({
  id,
  label,
  group: 'create',
  builderId,
  ...(addons ? { addons } : {}),
});

const trouble = (id: string, label: string, categories: LabTopic['categories']): LabTopic => ({
  id,
  label,
  group: 'troubleshoot',
  categories,
});

/** Topics the Quick lab category dropdown offers. Fault subsets follow the recipe pools. */
export const labTopics = (): LabTopic[] => {
  const topics: LabTopic[] = [
    create('create-deployment', 'Deployment', 'deployment'),
    create('create-service', 'Service', 'deployment', ['expose']),
    create('create-ingress', 'Ingress', 'deployment', ['expose', 'ingress']),
    create('create-httproute', 'HTTPRoute / Gateway', 'deployment', ['expose', 'httproute']),
    create('create-pod', 'Pod', 'pod'),
    create('create-rbac', 'ServiceAccount and RBAC', 'rbac'),
    create('create-cronjob', 'CronJob', 'cronjob'),
    create('create-pvc', 'PersistentVolumeClaim', 'pvc'),
    create('create-pv', 'PersistentVolume', 'pv'),
    create('create-storageclass', 'StorageClass', 'storageclass'),
    create('create-hpa', 'HorizontalPodAutoscaler', 'hpa'),
    create('create-vpa', 'VerticalPodAutoscaler', 'vpa'),
    create('create-helm', 'Helm', 'helm'),
    create('create-etcd-backup', 'etcd backup', 'etcd-backup'),
    create('create-etcd-restore', 'etcd restore', 'etcd-restore'),
    create('create-certificates', 'Certificates', 'certificates'),
    create('create-install-cluster', 'Install a cluster', 'install-cluster'),
    trouble('trouble-services', 'Services', [{ id: 'services' }]),
    trouble('trouble-ingress', 'Ingress', [{ id: 'ingress', faults: faultsStarting('ingress', 'ingress-') }]),
    trouble('trouble-httproute', 'HTTPRoute / Gateway', [{ id: 'ingress', faults: faultsStarting('ingress', 'route-') }]),
    trouble('trouble-deployment', 'Deployment', [{ id: 'pods' }]),
    trouble('trouble-nodes', 'Nodes', [{ id: 'nodes' }]),
    trouble('trouble-kubelet', 'Kubelet', [
      { id: 'nodes', faults: faultsStarting('nodes', 'kubelet-') },
      { id: 'nodeconfig', faults: faultsStarting('nodeconfig', 'kubelet-') },
    ]),
    trouble('trouble-podconfig', 'Pod configuration', [{ id: 'podconfig' }]),
    trouble('trouble-scheduling', 'Scheduling', [{ id: 'scheduling' }]),
    trouble('trouble-netpol', 'NetworkPolicy', [{ id: 'netpol' }]),
    trouble('trouble-dns', 'DNS', [{ id: 'dns' }]),
    trouble('trouble-rbac', 'RBAC', [{ id: 'rbac' }]),
    trouble('trouble-hpa', 'Horizontal Pod Autoscaling', [{ id: 'hpa' }]),
    trouble('trouble-vpa', 'Vertical Pod Autoscaling', [{ id: 'vpa' }]),
    trouble('trouble-cronjobs', 'Jobs and CronJobs', [{ id: 'cronjobs' }]),
    trouble('trouble-storage', 'Storage', [{ id: 'storage' }]),
    trouble('trouble-nodeconfig', 'Worker node configuration', [{ id: 'nodeconfig' }]),
    trouble('trouble-apiserver', 'API server', [
      { id: 'controlplane', faults: faultsStarting('controlplane', 'apiserver-') },
      { id: 'apiaccess', faults: faultsStarting('apiaccess', 'apiserver-') },
    ]),
    trouble('trouble-etcd', 'etcd', [{ id: 'controlplane', faults: faultsStarting('controlplane', 'etcd-') }]),
    trouble('trouble-scheduler', 'Scheduler', [{ id: 'controlplane', faults: faultsStarting('controlplane', 'scheduler-') }]),
    trouble('trouble-controlplane', 'Control plane', [{ id: 'controlplane' }]),
    trouble('trouble-apiaccess', 'API access', [{ id: 'apiaccess' }]),
    trouble('trouble-webhooks', 'Admission webhooks', [{ id: 'webhooks' }]),
    trouble('trouble-drain', 'Node drain', [{ id: 'drain' }]),
  ];
  for (const topic of topics) {
    if (topic.group === 'create') {
      const builder = BUILDERS.find((b) => b.id === topic.builderId);
      if (!builder) throw new Error(`Topic "${topic.id}" names unknown builder "${topic.builderId}".`);
      const parts = new Set([...builder.addons, ...builder.followUps].map((p) => p.id));
      for (const id of topic.addons ?? []) if (!parts.has(id)) throw new Error(`Topic "${topic.id}" names unknown add-on "${id}".`);
    } else {
      for (const source of topic.categories ?? []) {
        const category = CATEGORIES.find((c) => c.id === source.id);
        if (!category) throw new Error(`Topic "${topic.id}" names unknown category "${source.id}".`);
        if (!source.faults) continue;
        const known = new Set(faultList(category).map((f) => f.id));
        for (const id of source.faults) if (!known.has(id)) throw new Error(`Topic "${topic.id}" names unknown fault "${id}".`);
      }
    }
  }
  return topics;
};
