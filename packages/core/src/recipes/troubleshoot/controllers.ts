import { controlPlaneCategory, M } from './controlplane';
import type { FaultCategory } from './types';

/** The control plane faults that leave the API server answering: new workloads simply never start. */
const FAULTS = [
  'scheduler-command',
  'controller-manager-kubeconfig',
  'scheduler-kubeconfig-path',
  'scheduler-image-tag',
  'controller-manager-sa-key',
  'scheduler-manifest-removed',
  'scheduler-manifest-yaml',
  'controller-manager-command',
  'scheduler-leader-elect',
];

/**
 * A symptom-only question: kubectl works and accepts every object, but nothing new ever runs. Whether
 * Pods are missing or Pending tells the controller manager from the scheduler.
 */
export const controllersCategory: FaultCategory = {
  id: 'controllers',
  name: 'Controllers and scheduler',
  description: 'kubectl works, but new workloads never start: the scheduler or the controller manager on controlplane is broken.',
  track: 'cluster',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 10,
  points: 8,
  tags: ['troubleshooting', 'control-plane', 'static-pod', 'kube-scheduler', 'kube-controller-manager'],
  disruptive: true,
  settleSeconds: 60,
  fields: controlPlaneCategory.fields,
  shell: (v, state) => ({
    ...controlPlaneCategory.shell(v, state),
    title: 'New workloads never start',
    text: `\`kubectl apply\` succeeds in every namespace, but new workloads never start: Deployment \`web\` in namespace \`${v.NS}\` should run \`2\` ready replicas, and it does not. Fix the cluster so that \`web\` runs, and every control plane component on \`controlplane\` is \`Ready\`.

Do not change the Deployment, and leave only the four control plane manifests in \`${M}\`.`,
    spec: `- \`kube-scheduler\` and \`kube-controller-manager\` run as static Pods from \`${M}\`, with the commands, flags, kubeconfigs, keys and images kubeadm wrote`,
    hints: [
      `Do the Pods exist? kubectl -n ${v.NS} get deploy,rs,pods: no ReplicaSet or no Pods points at one control plane component, Pods that stay Pending with no events at another.`,
      'kubectl -n kube-system get pods: which control plane Pod is missing or not Ready? On controlplane, crictl ps -a and crictl logs <container-id> show containers that keep exiting.',
      `Static Pod manifests live in ${M}; the kubelet restarts a component when its manifest changes. Check its command, flags, paths and image against what exists on the node.`,
    ],
  }),
  faults: (v, state) => controlPlaneCategory.faults(v, state).filter((f) => FAULTS.includes(f.id)),
};
