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

const CLI = 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference';

const AWS_LINKS: [string, [string, string][]][] = [
  [
    'AWS CLI',
    [
      ['Command reference', `${CLI}/index.html`],
      ['Filter output with --query', 'https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-filter.html'],
    ],
  ],
  [
    'Networking and compute',
    [
      ['ec2 (VPCs, subnets, security groups)', `${CLI}/ec2/index.html`],
      ['elbv2', `${CLI}/elbv2/index.html`],
      ['autoscaling', `${CLI}/autoscaling/index.html`],
    ],
  ],
  [
    'Data and security',
    [
      ['s3api', `${CLI}/s3api/index.html`],
      ['rds', `${CLI}/rds/index.html`],
      ['dynamodb', `${CLI}/dynamodb/index.html`],
      ['iam', `${CLI}/iam/index.html`],
      ['kms', `${CLI}/kms/index.html`],
    ],
  ],
  [
    'Messaging',
    [
      ['sns', `${CLI}/sns/index.html`],
      ['sqs', `${CLI}/sqs/index.html`],
    ],
  ],
];

/** Links only to kubernetes.io, matching what the exam allows; AWS sessions get the AWS documentation. */
export function ReferencePanel({ aws = false }: { aws?: boolean }) {
  const [q, setQ] = useState('');
  const groups = aws ? AWS_LINKS : LINKS;
  const search = aws
    ? `https://docs.aws.amazon.com/search/doc-search.html?searchPath=documentation&searchQuery=`
    : 'https://kubernetes.io/search/?q=';
  return (
    <Card title="Docs">
      <form
        className="mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) window.open(`${search}${encodeURIComponent(q.trim())}`, '_blank', 'noopener');
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={aws ? 'Search docs.aws.amazon.com' : 'Search kubernetes.io'}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm placeholder:text-zinc-600"
        />
      </form>
      <div className="space-y-3">
        {groups.map(([group, links]) => (
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
