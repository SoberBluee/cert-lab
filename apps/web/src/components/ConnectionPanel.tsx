import type { SessionView } from '@cka/schema';
import { kubeconfigUrl } from '../api';
import { Card, CopyField } from './ui';

export function ConnectionPanel({ session }: { session: SessionView }) {
  const conn = session.connection;
  if (!conn) {
    return (
      <Card title="Connect">
        <p className="text-sm text-zinc-500">Connection details appear once the lab is ready.</p>
      </Card>
    );
  }
  return (
    <Card title="Connect">
      <div className="space-y-3">
        {conn.nodes.map((n) => (
          <CopyField key={n.name} label={`${n.name}  ${n.ip}`} value={n.sshCommand} />
        ))}
        {conn.exportLine && (
          <>
            <CopyField label="kubectl from your machine" value={conn.exportLine} />
            {session.context && <CopyField label="context" value={`kubectl config use-context ${session.context}`} />}
            <a
              href={kubeconfigUrl}
              download="cka-lab.kubeconfig"
              className="inline-block text-sm text-sky-400 underline hover:text-sky-300"
            >
              Download kubeconfig
            </a>
          </>
        )}
        <p className="text-xs leading-relaxed text-zinc-500">
          The control plane shell is set up like the exam: <code className="text-zinc-400">k</code> alias with completion,{' '}
          <code className="text-zinc-400">$do</code>, <code className="text-zinc-400">$now</code>, and vim with 2-space tabs.
          From there, <code className="text-zinc-400">ssh worker-1</code> works.
        </p>
        <p className="text-xs leading-relaxed text-zinc-500">
          The terminal on this page opens the same SSH sessions in the browser.
        </p>
      </div>
    </Card>
  );
}
