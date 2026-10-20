import { useMemo, useState } from 'react';
import { EventLog, Nodes, StepControls, card, selectCls, useStepper } from '../components';
import { CLIENT_IP, ipTrace, parseIpv4, subnetInfo } from '../logic/ip';

export function IpSim() {
  const [dest, setDest] = useState('192.168.1.25');
  const [prefix, setPrefix] = useState(24);
  const steps = useMemo(() => ipTrace(dest, prefix), [dest, prefix]);
  const info = useMemo(() => subnetInfo(dest, prefix), [dest, prefix]);
  const mine = useMemo(() => subnetInfo(CLIENT_IP, prefix), [prefix]);
  const s = useStepper(steps.length);
  const current = s.index >= 0 ? steps[s.index] : undefined;
  const valid = parseIpv4(dest) !== null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-zinc-300">
          Destination IPv4
          <input
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            className={`${selectCls} ml-2 w-40 font-mono`}
            aria-label="Destination IPv4 address"
          />
        </label>
        <label className="text-sm text-zinc-300">
          Client prefix
          <select value={prefix} onChange={(e) => setPrefix(Number(e.target.value))} className={`${selectCls} ml-2`} aria-label="Client subnet prefix">
            {[16, 24, 25, 28].map((p) => (
              <option key={p} value={p}>/{p}</option>
            ))}
          </select>
        </label>
        {!valid && <span className="text-sm text-red-300" role="alert">Enter a valid IPv4 address, e.g. 192.168.1.25 or 93.184.216.34.</span>}
      </div>

      <p className="text-sm text-zinc-400">
        Client is <span className="font-mono text-zinc-200">{CLIENT_IP}/{prefix}</span>. Try a local destination (192.168.1.25), then a public one (93.184.216.34), then shrink the prefix to /28 and watch the local one turn remote.
      </p>

      <Nodes nodes={['Client', 'Gateway', 'Server']} active={current?.to ?? 'Client'} />

      {info && mine && (
        <div className={`${card} grid gap-2 text-sm sm:grid-cols-2`} aria-label="Subnet calculation">
          <p className="text-zinc-300">Destination /{prefix}: network <span className="font-mono">{info.network}</span>, broadcast <span className="font-mono">{info.broadcast}</span>, hosts <span className="font-mono">{info.firstHost} – {info.lastHost}</span> ({info.hostCount} usable)</p>
          <p className="text-zinc-300">Client network: <span className="font-mono">{mine.network}/{prefix}</span> (mask {info.mask}) — {info.network === mine.network ? 'same network: direct delivery.' : 'different network: via gateway.'}</p>
        </div>
      )}

      <StepControls s={s} total={steps.length} />
      <EventLog entries={steps.slice(0, s.index + 1)} />
      {current && (
        <p className="text-sm text-zinc-300" role="status">
          <span className="font-medium text-zinc-100">What just happened?</span> {current.detail}
        </p>
      )}
    </div>
  );
}
