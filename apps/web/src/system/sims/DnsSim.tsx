import { useMemo, useState } from 'react';
import { EventLog, Nodes, StepControls, selectCls, useStepper } from '../components';
import { ANSWERS, DNS_HOST, dnsSteps, type CacheState, type RecordType } from '../logic/dns';

const NODE_NAMES = ['Browser', 'Browser cache', 'Recursive resolver', 'Root server', 'TLD server', 'Authoritative'];

export function DnsSim() {
  const [cache, setCache] = useState<CacheState>('cold');
  const [type, setType] = useState<RecordType>('A');
  const steps = useMemo(() => dnsSteps(cache, type), [cache, type]);
  const s = useStepper(steps.length);
  const current = s.index >= 0 ? steps[s.index] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-zinc-300">
          Cache state
          <select value={cache} onChange={(e) => { setCache(e.target.value as CacheState); s.reset(); }} className={`${selectCls} ml-2`} aria-label="Cache state">
            <option value="cold">Cold (nothing cached)</option>
            <option value="warm">Warm (valid cached answer)</option>
            <option value="expired">Expired (TTL ran out)</option>
          </select>
        </label>
        <label className="text-sm text-zinc-300">
          Record type
          <select value={type} onChange={(e) => { setType(e.target.value as RecordType); s.reset(); }} className={`${selectCls} ml-2`} aria-label="Record type">
            <option value="A">A (IPv4)</option>
            <option value="AAAA">AAAA (IPv6)</option>
            <option value="CNAME">CNAME (alias)</option>
          </select>
        </label>
      </div>
      <p className="text-sm text-zinc-400">
        Resolving <span className="font-mono text-zinc-200">{DNS_HOST}</span> ({type} → <span className="font-mono">{ANSWERS[type]}</span>). Compare the three cache states: a warm hit never leaves the browser; expired behaves like cold.
      </p>

      <Nodes nodes={NODE_NAMES} active={current?.to} />
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
