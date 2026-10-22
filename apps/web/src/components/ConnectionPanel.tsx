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
  if (conn.aws) {
    return (
      <Card title="Connect">
        <div className="space-y-3">
          <CopyField label="AWS CLI from your own terminal" value={conn.aws.exportLine} />
          <p className="text-xs leading-relaxed text-zinc-500">
            Every <code className="text-zinc-400">aws</code> command goes to Floci at {conn.aws.endpoint}, in account{' '}
            <code className="text-zinc-400">{conn.aws.accountId}</code> ({conn.aws.region}). The account is new for this attempt, so
            it holds only what the scenario set up and what you create. Reset starts another one.
          </p>
          <p className="text-xs leading-relaxed text-zinc-500">
            The terminal on this page is a shell on your machine with that setup and tab completion, in{' '}
            <code className="break-all text-zinc-400">{conn.aws.workdir}</code>. Credentials in your own ~/.aws are not used.
          </p>
        </div>
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
