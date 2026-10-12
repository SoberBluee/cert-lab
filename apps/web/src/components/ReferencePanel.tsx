import { useState } from 'react';
import { Card } from './ui';

const DOCS = 'https://kubernetes.io/docs';

const LINKS: [string, [string, string][]][] = [
  [
    'Reference',
    [
      ['kubectl quick reference', `${DOCS}/reference/kubectl/quick-reference/`],
      ['kubectl commands', `${DOCS}/reference/kubectl/generated/`],
      ['kubeadm', `${DOCS}/reference/setup-tools/kubeadm/`],
    ],
  ],
  [
    'Troubleshooting',
    [
      ['Debug a cluster', `${DOCS}/tasks/debug/debug-cluster/`],
      ['Debug applications', `${DOCS}/tasks/debug/debug-application/`],
      ['Static pods', `${DOCS}/tasks/configure-pod-container/static-pod/`],
      ['Certificates with kubeadm', `${DOCS}/tasks/administer-cluster/kubeadm/kubeadm-certs/`],
    ],
  ],
  [
    'Cluster',
    [
      ['Upgrade with kubeadm', `${DOCS}/tasks/administer-cluster/kubeadm/kubeadm-upgrade/`],
      ['etcd backup and restore', `${DOCS}/tasks/administer-cluster/configure-upgrade-etcd/`],
      ['RBAC', `${DOCS}/reference/access-authn-authz/rbac/`],
    ],
  ],
  [
    'Workloads and scheduling',
    [
      ['Assign Pods to nodes', `${DOCS}/concepts/scheduling-eviction/assign-pod-node/`],
      ['Taints and tolerations', `${DOCS}/concepts/scheduling-eviction/taint-and-toleration/`],
      ['Deployments', `${DOCS}/concepts/workloads/controllers/deployment/`],
    ],
  ],
  [
    'Networking and storage',
    [
      ['Services', `${DOCS}/concepts/services-networking/service/`],
      ['Network policies', `${DOCS}/concepts/services-networking/network-policies/`],
      ['Persistent volumes', `${DOCS}/concepts/storage/persistent-volumes/`],
    ],
  ],
];

/** Links only to kubernetes.io, matching what the exam allows. */
export function ReferencePanel() {
  const [q, setQ] = useState('');
  return (
    <Card title="Docs">
      <form
        className="mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) window.open(`https://kubernetes.io/search/?q=${encodeURIComponent(q.trim())}`, '_blank', 'noopener');
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search kubernetes.io"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm placeholder:text-zinc-600"
        />
      </form>
      <div className="space-y-3">
        {LINKS.map(([group, links]) => (
          <div key={group}>
            <div className="mb-1 text-xs text-zinc-500">{group}</div>
            <ul className="space-y-0.5">
              {links.map(([label, href]) => (
                <li key={href}>
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-400 hover:text-sky-300 hover:underline">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
