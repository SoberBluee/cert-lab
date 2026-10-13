import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Button, buttonClass, Card, ErrorBanner } from '../components/ui';
import { sessionKey, useSession } from '../hooks';

const INCLUDED: [string, string][] = [
  ['Nodes', '1 control plane (controlplane) and 2 workers (worker-1, worker-2), built with kubeadm'],
  ['Network', 'Calico CNI, CoreDNS, kube-proxy'],
  ['Ingress', 'Traefik, IngressClass traefik (the default), on http://<node>:30080'],
  ['Gateway API', 'standard CRDs, GatewayClass traefik and Gateway traefik/traefik-gateway accepting routes from every namespace'],
  ['Tools', 'kubectl, kubeadm, Helm, crictl, etcdctl, jq, vim; ssh between nodes from controlplane'],
];

const code = 'rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-200';

export function PlaygroundPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const session = useSession().data;
  const images = useQuery({ queryKey: ['images'], queryFn: api.images, retry: false });
  const clusterBuilt = images.data?.find((i) => i.name === 'cluster')?.available;

  const start = useMutation({
    mutationFn: api.startPlayground,
    onSuccess: (view) => {
      qc.setQueryData(sessionKey, view);
      navigate('/session');
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Playground</h1>
        <p className="mt-1 text-sm text-zinc-400">
          A healthy 3-node cluster with nothing to solve and nothing graded. Break it, fix it, try things out. Reset brings it back to a clean cluster.
        </p>
      </div>

      {images.data && !clusterBuilt && (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          The cluster image is not built yet. Run <code className={code}>./cka images build</code> once (15-25 minutes).
        </div>
      )}

      <Card title="What you get">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
          {INCLUDED.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="text-zinc-200">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <ErrorBanner error={start.error} />
      {session ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm">
          <span className="text-zinc-300">
            {session.mode === 'playground' ? 'The playground is open.' : `A session for "${session.scenarioTitle}" is open. End it to start the playground.`}
          </span>
          <Link to="/session" className={`${buttonClass('primary')} ml-auto`}>
            Go to session
          </Link>
        </div>
      ) : (
        <Button variant="primary" disabled={start.isPending || clusterBuilt === false} onClick={() => start.mutate()}>
          {start.isPending ? 'Starting…' : 'Start playground'}
        </Button>
      )}
    </div>
  );
}
