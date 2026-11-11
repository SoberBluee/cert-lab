import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PlaygroundKind } from '@cka/schema';
import { api } from '../api';
import { Button, ErrorBanner, linkClass, Notice, PageHeader, Toggle } from '../components/ui';
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

const code = 'rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[13px] text-zinc-200';

function Included({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[7rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-zinc-500">{k}</dt>
          <dd className="text-zinc-300">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One playground: its name, one line on it and the way to start it; what it has opens on a click. */
function Option({ title, intro, action, more }: { title: string; intro: ReactNode; action: ReactNode; more: { label: string; body: ReactNode }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = more.find((m) => m.label === open);
  return (
    <section className="rounded-xl bg-zinc-900/70 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
          <p className="mt-1 text-[15px] text-zinc-400">{intro}</p>
        </div>
        {action}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {more.map((m) => (
          <Toggle key={m.label} open={open === m.label} onClick={() => setOpen(open === m.label ? null : m.label)}>
            {m.label}
          </Toggle>
        ))}
      </div>
      {shown && <div className="mt-4">{shown.body}</div>}
    </section>
  );
}

export function PlaygroundPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const session = useSession().data;
  const images = useQuery({ queryKey: ['images'], queryFn: api.images, retry: false });
  const tart = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false }).data?.driver === 'tart';
  const built = (name: string) => images.data?.find((i) => i.name === name)?.available;

  const start = useMutation({
    mutationFn: ({ kind, fresh }: { kind: PlaygroundKind; fresh: boolean }) => api.startPlayground(kind, fresh),
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      navigate('/session');
    },
  });

  // A playground left open keeps everything done on it, so starting another one replaces it with clean nodes.
  const replaces = session?.mode === 'playground' && (session.state === 'running' || session.state === 'failed') ? session : undefined;
  const openedAt = replaces && new Date(replaces.startedAt);
  const startButton = (kind: PlaygroundKind, label: string, image: string) =>
    (!session || replaces) && (
      <Button
        variant={replaces ? 'secondary' : 'primary'}
        disabled={start.isPending || built(image) === false}
        onClick={() => {
          if (replaces && !confirm(`End ${replaces.scenarioTitle} and start a fresh ${label}? Everything done on the open one is lost.`)) return;
          start.mutate({ kind, fresh: Boolean(replaces) });
        }}
      >
        {start.isPending && start.variables?.kind === kind ? 'Starting…' : replaces ? 'Start fresh' : 'Start'}
      </Button>
    );

  const network =
    "the nodes sit on the Mac's VM network (192.168.64.0/24 by default): pick a pod CIDR outside it, e.g. 10.244.0.0/16" +
    (tart ? '. Tart VMs reach each other through the Mac, which drops IP-in-IP: use a VXLAN overlay (Flannel by default, Calico once set to VXLAN)' : '');

  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-10">
      <PageHeader title="Playground" intro="Free practice with nothing to solve and nothing graded." />

      {(start.error || session || (images.data && !built('bare') && !built('cluster'))) && (
        <div className="-mt-4 space-y-3">
          {images.data && !built('bare') && !built('cluster') && (
            <Notice tone="warn">
              The lab images are not built yet. Run <code className={code}>./cka images build</code> once (15-25 minutes).
            </Notice>
          )}
          <ErrorBanner error={start.error} />
          {session && (
            <Notice
              action={
                <Link to="/session" className={linkClass}>
                  Go to session →
                </Link>
              }
            >
              {openedAt ? (
                <>
                  <span className="font-medium text-zinc-100">{session.scenarioTitle}</span> is open since{' '}
                  {openedAt.toDateString() === new Date().toDateString() ? openedAt.toLocaleTimeString() : openedAt.toLocaleString()}, with everything
                  done on it.
                </>
              ) : session.mode === 'playground' ? (
                <>
                  <span className="font-medium text-zinc-100">{session.scenarioTitle}</span> is open.
                </>
              ) : (
                <>
                  <span className="font-medium text-zinc-100">{session.scenarioTitle}</span> is open. End it to start a playground.
                </>
              )}
            </Notice>
          )}
        </div>
      )}

      <Option
        title="Cluster"
        intro="A healthy 3-node cluster. Break it, fix it, try things out."
        action={startButton('cluster', 'cluster playground', 'cluster')}
        more={[{ label: "What's on it", body: <Included rows={CLUSTER} /> }]}
      />

      <Option
        title="Install a cluster"
        intro={
          <>
            Three bare Ubuntu VMs. Build a kubeadm cluster from scratch until <code className={code}>kubectl get nodes</code> shows all three Ready.
          </>
        }
        action={startButton('install', 'install playground', 'os')}
        more={[
          { label: "What's on it", body: <Included rows={[...INSTALL, ['Network', network]]} /> },
          {
            label: 'The steps, if you get stuck',
            body: (
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
                {INSTALL_STEPS.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            ),
          },
        ]}
      />
      {images.data && built('bare') && !built('os') && (
        <Notice tone="warn">
          The plain Ubuntu image for Install a cluster is not built yet. Run <code className={code}>./cka images os</code> once (about 5 minutes, no
          rebuild).
        </Notice>
      )}
    </div>
  );
}
