import type { CkaDomain, LabTopic } from '@cka/schema';
import { BUILDERS } from './create';
import { CATEGORIES, faultList } from './troubleshoot';

/** A topic before the catalog gives it its curriculum domain. */
type TopicDraft = Omit<LabTopic, 'domain'>;

/**
 * Topics scored in another domain than their builder's: publishing an app is a networking task,
 * although the Deployment builder is a workloads builder.
 */
const DOMAIN_OF: Record<string, CkaDomain> = {
  'create-service': 'services-networking',
  'create-ingress': 'services-networking',
  'create-httproute': 'services-networking',
};

const faultsStarting = (categoryId: string, prefix: string): string[] => {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) throw new Error(`No fault category "${categoryId}".`);
  const ids = faultList(category).map((f) => f.id).filter((id) => id.startsWith(prefix));
  if (!ids.length) throw new Error(`Category "${categoryId}" has no fault starting with "${prefix}".`);
  return ids;
};

const create = (id: string, label: string, builderId: string, tags: string[], addons?: string[], anyParts?: string[]): TopicDraft => ({
  id,
  label,
  group: 'create',
  builderId,
  ...(addons ? { addons } : {}),
  ...(anyParts ? { anyParts } : {}),
  tags,
});

const trouble = (id: string, label: string, categories: LabTopic['categories'], tags: string[]): TopicDraft => ({
  id,
  label,
  group: 'troubleshoot',
  tags,
  categories,
});

/** Topics the Quick lab category dropdown offers. Fault subsets follow the recipe pools. */
export const labTopics = (): LabTopic[] => {
  const topics: TopicDraft[] = [
    create('create-deployment', 'Deployment', 'deployment', ['deployment', 'rollout', 'rollback', 'scale']),
    create('create-service', 'Service', 'deployment', ['service', 'expose'], ['expose']),
    create('create-ingress', 'Ingress', 'deployment', ['ingress'], ['expose', 'ingress']),
    create('create-httproute', 'HTTPRoute / Gateway', 'deployment', ['httproute', 'gateway-api'], ['expose', 'httproute']),
    create('create-pod', 'Pod', 'pod', ['pod', 'sidecar', 'native-sidecar', 'init-container', 'security-context']),
    create('create-secret-types', 'TLS and registry Secrets', 'pod', ['secret', 'tls-secret', 'imagepullsecrets', 'docker-registry'], ['secret-types']),
    create('create-rbac', 'ServiceAccount and RBAC', 'rbac', ['rbac', 'serviceaccount', 'role', 'clusterrole']),
    create('create-cronjob', 'CronJob', 'cronjob', ['cronjob', 'job']),
    create('create-pvc', 'PersistentVolumeClaim', 'pvc', ['pvc']),
    create('create-pv', 'PersistentVolume', 'pv', ['pv']),
    create('create-storageclass', 'StorageClass', 'storageclass', ['storageclass']),
    create('create-hpa', 'HorizontalPodAutoscaler', 'hpa', ['hpa']),
    create('create-vpa', 'VerticalPodAutoscaler', 'vpa', ['vpa']),
    // Quick lab practises these with one Deployment add-on; questions of either workload builder with a matching part count.
    create('create-config', 'ConfigMaps and Secrets', 'deployment', ['configmap', 'secret', 'env', 'envfrom'], ['env'], ['env', 'html-configmap', 'config-volume']),
    create(
      'create-placement',
      'Scheduling and placement',
      'deployment',
      ['scheduling', 'taints', 'tolerations', 'nodeSelector', 'nodeselector', 'affinity', 'node-affinity', 'anti-affinity', 'topology-spread', 'static-pod', 'manual-scheduling'],
      ['toleration'],
      ['node-selector', 'toleration', 'spread', 'priority-class', 'placement'],
    ),
    create('create-helm', 'Helm', 'helm', ['helm']),
    create('create-etcd-backup', 'etcd backup', 'etcd-backup', ['backup', 'snapshot']),
    create('create-etcd-restore', 'etcd restore', 'etcd-restore', ['restore']),
    create('create-certificates', 'Certificates', 'certificates', ['certificates', 'openssl', 'pki']),
    create('create-install-cluster', 'Install a cluster', 'install-cluster', ['install', 'kubeadm-init']),
    create('create-upgrade', 'Cluster upgrade', 'upgrade', ['upgrade']),
    create('create-kustomize', 'Kustomize', 'kustomize', ['kustomize']),
    create('create-crds', 'CRDs and operators', 'crds', ['crd', 'operator']),
    create('create-observe', 'Resource usage, logs and events', 'observe', ['kubectl-top', 'sort-by', 'logs', 'qos', 'crictl', 'events', 'api-resources']),
    create('create-dynamic-storage', 'Dynamic provisioning', 'dynamic-storage', ['dynamic-provisioning', 'local-path', 'default-class']),
    create('create-infra', 'Node infrastructure', 'infra', ['sysctl', 'kernel-modules', 'dpkg', 'kubeadm-join', 'cni']),
    create('create-netops', 'Service types and policies', 'netops', ['networkpolicy', 'loadbalancer', 'endpointslice']),
    create('create-workload-ops', 'Workload operations', 'workload-ops', ['resources', 'capacity', 'priorityclass', 'serviceaccount-token', 'in-cluster-api']),
    create('create-gateway', 'Gateway API with TLS', 'gateway', ['tls', 'migration', 'header-match']),
    create('create-cluster-info', 'Kubeconfig and cluster facts', 'cluster-info', ['kubeconfig', 'cidr', 'kube-proxy', 'static-pod']),
    create('create-workload-controllers', 'StatefulSets and DaemonSets', 'workload-controllers', ['statefulset', 'daemonset', 'headless']),
    trouble('trouble-services', 'Services', [{ id: 'services' }], ['service', 'endpoints', 'selector', 'targetport', 'named-port', 'externalname', 'headless', 'kube-proxy']),
    // The Ingress faults, and the controller behind every Ingress (its IngressClass, Deployment and NodePort).
    trouble('trouble-ingress', 'Ingress', [{ id: 'ingress', faults: [...faultsStarting('ingress', 'ingress'), ...faultsStarting('ingress', 'controller-')] }], ['ingress']),
    trouble('trouble-httproute', 'HTTPRoute / Gateway', [{ id: 'ingress', faults: faultsStarting('ingress', 'route-') }], ['httproute', 'gateway-api']),
    trouble('trouble-deployment', 'Deployment', [{ id: 'pods' }], ['deployment', 'pods', 'rollout', 'imagepullbackoff', 'command']),
    trouble('trouble-nodes', 'Nodes', [{ id: 'nodes' }], ['node', 'notready', 'containerd', 'container-runtime', 'cni']),
    trouble('trouble-kubelet', 'Kubelet', [
      { id: 'nodes', faults: faultsStarting('nodes', 'kubelet-') },
      { id: 'nodeconfig', faults: faultsStarting('nodeconfig', 'kubelet-') },
    ], ['kubelet']),
    trouble('trouble-podconfig', 'Pod configuration', [{ id: 'podconfig' }], ['configmap', 'secret', 'volumes', 'security-context', 'immutable']),
    trouble('trouble-scheduling', 'Scheduling', [{ id: 'scheduling' }], ['scheduling', 'affinity', 'topology-spread', 'nodeSelector']),
    trouble('trouble-netpol', 'NetworkPolicy', [{ id: 'netpol' }], ['networkpolicy', 'egress', 'namespaceselector']),
    trouble('trouble-dns', 'DNS', [{ id: 'dns' }], ['dns', 'coredns']),
    trouble('trouble-rbac', 'RBAC', [{ id: 'rbac' }], ['rbac', 'serviceaccount', 'clusterrole', 'auth-can-i']),
    trouble('trouble-hpa', 'Horizontal Pod Autoscaling', [{ id: 'hpa' }], ['hpa']),
    trouble('trouble-vpa', 'Vertical Pod Autoscaling', [{ id: 'vpa' }], ['vpa']),
    trouble('trouble-cronjobs', 'Jobs and CronJobs', [{ id: 'cronjobs' }], ['cronjob', 'job']),
    trouble('trouble-storage', 'Storage', [{ id: 'storage' }], ['pvc', 'pv', 'storage', 'claimref', 'accessmodes']),
    trouble('trouble-nodeconfig', 'Worker node configuration', [{ id: 'nodeconfig' }], ['eviction', 'memorypressure', 'kubelet-config']),
    trouble('trouble-apiserver', 'API server', [
      { id: 'controlplane', faults: faultsStarting('controlplane', 'apiserver-') },
      { id: 'apiaccess', faults: faultsStarting('apiaccess', 'apiserver-') },
    ], ['kube-apiserver']),
    trouble('trouble-etcd', 'etcd', [{ id: 'controlplane', faults: faultsStarting('controlplane', 'etcd-') }], ['etcd']),
    trouble('trouble-scheduler', 'Scheduler', [{ id: 'controlplane', faults: faultsStarting('controlplane', 'scheduler-') }], ['kube-scheduler', 'scheduler', 'manual-scheduling']),
    trouble('trouble-controlplane', 'Control plane', [{ id: 'controlplane' }], ['control-plane', 'static-pod']),
    trouble('trouble-apiaccess', 'API access', [{ id: 'apiaccess' }], ['kubeconfig']),
    trouble('trouble-drain', 'Node drain', [{ id: 'drain' }], ['drain', 'pdb']),
    trouble('trouble-restarts', 'Restarting Pods', [{ id: 'restarts' }], ['probes', 'liveness', 'readinessprobe', 'crashloop', 'crashloopbackoff', 'oomkilled']),
    trouble('trouble-admission', 'Rejected Pods', [{ id: 'admission' }], ['admission', 'resourcequota', 'limitrange', 'pod-security', 'webhook']),
    trouble('trouble-unschedulable', 'Unschedulable node', [{ id: 'unschedulable' }], ['taints', 'cordon', 'unschedulable']),
    trouble('trouble-controllers', 'Controllers and scheduler', [{ id: 'controllers' }], ['kube-controller-manager']),
    trouble('trouble-provisioning', 'Dynamic provisioning', [{ id: 'provisioning' }], ['dynamic-provisioning', 'local-path']),
    trouble('trouble-gateway', 'Gateway across namespaces', [{ id: 'gateway' }], ['referencegrant']),
  ];
  const everyPart = new Set(BUILDERS.flatMap((b) => [...b.addons, ...b.followUps].map((p) => p.id)));
  return topics.map((topic): LabTopic => {
    // Recipes are CKA content, so their domain is always a CKA domain.
    let domain: CkaDomain | undefined;
    if (topic.group === 'create') {
      const builder = BUILDERS.find((b) => b.id === topic.builderId);
      if (!builder) throw new Error(`Topic "${topic.id}" names unknown builder "${topic.builderId}".`);
      const parts = new Set([...builder.addons, ...builder.followUps].map((p) => p.id));
      for (const id of topic.addons ?? []) if (!parts.has(id)) throw new Error(`Topic "${topic.id}" names unknown add-on "${id}".`);
      for (const id of topic.anyParts ?? []) if (!everyPart.has(id)) throw new Error(`Topic "${topic.id}" names unknown part "${id}".`);
      domain = builder.domain as CkaDomain;
    } else {
      for (const source of topic.categories ?? []) {
        const category = CATEGORIES.find((c) => c.id === source.id);
        if (!category) throw new Error(`Topic "${topic.id}" names unknown category "${source.id}".`);
        domain ??= category.domain as CkaDomain;
        if (!source.faults) continue;
        const known = new Set(faultList(category).map((f) => f.id));
        for (const id of source.faults) if (!known.has(id)) throw new Error(`Topic "${topic.id}" names unknown fault "${id}".`);
      }
    }
    if (!domain) throw new Error(`Topic "${topic.id}" has no builder or category.`);
    return { ...topic, domain: DOMAIN_OF[topic.id] ?? domain };
  });
};
