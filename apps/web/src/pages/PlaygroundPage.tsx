import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PlaygroundKind } from '@cka/schema';
import { api } from '../api';
import { Button, buttonClass, Card, ErrorBanner } from '../components/ui';
import { sessionKey, useSession } from '../hooks';

const CLUSTER: [string, string][] = [
  ['Nodes', '1 control plane (controlplane) and 2 workers (worker-1, worker-2), built with kubeadm'],
  ['Network', 'Calico CNI, CoreDNS, kube-proxy'],
  ['Ingress', 'Traefik, IngressClass traefik (the default), on http://<node>:30080'],
  ['Gateway API', 'standard CRDs, GatewayClass traefik and Gateway traefik/traefik-gateway accepting routes from every namespace'],
  ['Tools', 'kubectl, kubeadm, Helm, crictl, etcdctl, jq, vim; ssh between nodes from controlplane'],
];

const INSTALL: [string, string][] = [
  ['Nodes', 'controlplane, worker-1 and worker-2: Ubuntu 24.04, 2 vCPU and 2 GB each, swap off'],
  ['Access', 'user ubuntu with passwordless sudo; ssh worker-1 and ssh worker-2 from controlplane; every node name in /etc/hosts'],
  ['Tools', 'curl, gpg, vim (2-space indent), jq, bash-completion; internet access for apt and image pulls'],
  ['Shell', 'alias k=kubectl, with completion in every shell started after kubectl is installed'],
  ['Not there', 'the kernel modules and sysctls Kubernetes needs, containerd, kubeadm, kubelet, kubectl, a CNI'],
];

/** Only names the steps, so the commands still come from memory. */
const INSTALL_STEPS = [
  'On every node: load overlay and br_netfilter, and turn on IP forwarding, for now and after a reboot',
  'On every node: install containerd and switch it to the systemd cgroup driver',
  'On every node: add the pkgs.k8s.io repository, then install and hold kubeadm, kubelet and kubectl',
  'On controlplane: kubeadm init with a pod network CIDR, then a kubeconfig for ubuntu',
  'Install a CNI (Calico, Flannel, ...) with a pod CIDR that matches',
  'On each worker: kubeadm join with the command kubeadm prints',
];

const code = 'rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-200';

function Included({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-zinc-500">{k}</dt>
          <dd className="text-zinc-200">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Missing({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">{children}</div>;
}

export function PlaygroundPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const session = useSession().data;
  const images = useQuery({ queryKey: ['images'], queryFn: api.images, retry: false });
  const tart = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false }).data?.driver === 'tart';
  const built = (name: string) => images.data?.find((i) => i.name === name)?.available;

  const start = useMutation({
    mutationFn: (kind: PlaygroundKind) => api.startPlayground(kind),
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      navigate('/session');
    },
  });

  const startButton = (kind: PlaygroundKind, label: string, image: string) =>
    !session && (
      <Button variant="primary" className="mt-4" disabled={start.isPending || built(image) === false} onClick={() => start.mutate(kind)}>
        {start.isPending && start.variables === kind ? 'Starting…' : label}
      </Button>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Playground</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Free practice with nothing to solve and nothing graded. Reset brings back a clean start.
        </p>
      </div>

      {images.data && !built('bare') && !built('cluster') && (
        <Missing>
          The lab images are not built yet. Run <code className={code}>./cka images build</code> once (15-25 minutes).
        </Missing>
      )}

      <ErrorBanner error={start.error} />
      {session && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm">
          <span className="text-zinc-300">
            {session.mode === 'playground'
              ? `${session.scenarioTitle} is open.`
              : `A session for "${session.scenarioTitle}" is open. End it to start a playground.`}
          </span>
          <Link to="/session" className={`${buttonClass('primary')} ml-auto`}>
            Go to session
          </Link>
        </div>
      )}

      <Card title="Cluster">
        <p className="mb-4 text-sm text-zinc-400">A healthy 3-node cluster. Break it, fix it, try things out.</p>
        <Included rows={CLUSTER} />
        {startButton('cluster', 'Start playground', 'cluster')}
      </Card>

      <Card title="Install a cluster">
        <p className="mb-4 text-sm text-zinc-400">
          Three Ubuntu VMs with nothing of Kubernetes on them, set up like exam nodes. Build a kubeadm cluster from scratch, without the docs. Done when{' '}
          <code className={code}>kubectl get nodes</code> shows all three Ready.
        </p>
        <Included
          rows={[
            ...INSTALL,
            [
              'Network',
              "the nodes sit on the Mac's VM network (192.168.64.0/24 by default): pick a pod CIDR outside it, e.g. 10.244.0.0/16" +
                (tart ? '. Tart VMs reach each other through the Mac, which drops IP-in-IP: use a VXLAN overlay (Flannel by default, Calico once set to VXLAN)' : ''),
            ],
          ]}
        />
        <details className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/40 text-sm">
          <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-400 select-none">The steps, if you get stuck (no commands)</summary>
          <ol className="list-decimal space-y-1 px-3 pb-3 pl-8 text-zinc-300">
            {INSTALL_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>
        {images.data && built('bare') && !built('os') && (
          <div className="mt-4">
            <Missing>
              The plain Ubuntu image is not built yet. Run <code className={code}>./cka images os</code> once (about 5 minutes, no rebuild).
            </Missing>
          </div>
        )}
        {startButton('install', 'Start install playground', 'os')}
      </Card>
    </div>
  );
}
