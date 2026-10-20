import { useMemo, useState } from 'react';
import { EventLog, Nodes, StepControls, selectCls, useStepper } from '../components';
import { flowSteps, type Protocol } from '../logic/tcpudp';

export function TcpUdpSim() {
  const [protocol, setProtocol] = useState<Protocol>('tcp');
  const [drop, setDrop] = useState(true);
  const steps = useMemo(() => flowSteps(protocol, drop), [protocol, drop]);
  const s = useStepper(steps.length);
  const current = s.index >= 0 ? steps[s.index] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-zinc-300">
          Protocol
          <select
            value={protocol}
            onChange={(e) => { setProtocol(e.target.value as Protocol); s.reset(); }}
            className={`${selectCls} ml-2`}
            aria-label="Protocol"
          >
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={drop} onChange={(e) => { setDrop(e.target.checked); s.reset(); }} />
          Lose segment / datagram 2 once
        </label>
      </div>
      <p className="text-sm text-zinc-400">
        Run {protocol.toUpperCase()}{drop ? ' with one loss' : ' clean'}, then switch protocol and compare: who notices the loss, who pays for the handshake, and what the app receives.
      </p>

      <Nodes nodes={['Client', 'Server']} active={current?.to ?? 'Client'} />
      {current && (
        <p className="text-sm" role="status">
          <span className={`rounded px-2 py-1 font-mono text-xs ${current.lost ? 'bg-red-950/60 text-red-200' : 'bg-sky-950/60 text-sky-200'}`}>
            {current.from} → {current.to}: {current.label}
          </span>
        </p>
      )}

      <StepControls s={s} total={steps.length} />
      <EventLog entries={steps.slice(0, s.index + 1)} />
      {s.done && (
        <p className="text-sm text-zinc-300" role="status">
          <span className="font-medium text-zinc-100">Trade-off:</span>{' '}
          {protocol === 'tcp'
            ? 'TCP spent a handshake round trip plus ACKs (and a retransmit delay when loss happened) to guarantee complete, ordered data.'
            : 'UDP spent nothing on setup or tracking — with loss, the application simply never sees that datagram. Great for live media/DNS-style exchanges, risky for data that must arrive whole.'}
        </p>
      )}
    </div>
  );
}
