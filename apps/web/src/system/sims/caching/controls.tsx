import { POLICIES } from '../../logic/cache';
import { STRATEGIES, type CachingConfig } from '../../logic/caching';
import type { ControlId } from '../../logic/cachingLesson';
import { Range, Segmented, Toggle } from '../../stage/widgets';

/** The widget for one control, reading from and patching a config. */
export function Control({ id, cfg, onPatch, disabled }: { id: ControlId; cfg: CachingConfig; onPatch: (p: Partial<CachingConfig>) => void; disabled?: boolean }) {
  switch (id) {
    case 'cacheOn':
      return <Toggle label="Cache" on={cfg.cacheOn} onChange={(cacheOn) => onPatch({ cacheOn })} disabled={disabled} />;
    case 'capacity':
      return <Range label="Cache slots" value={cfg.capacity} min={2} max={16} format={(v) => `${v}`} onChange={(capacity) => onPatch({ capacity })} disabled={disabled} />;
    case 'rps':
      return <Range label="Traffic" value={cfg.rps} min={1} max={14} format={(v) => `${v} req/s`} onChange={(rps) => onPatch({ rps })} disabled={disabled} />;
    case 'policy':
      return <Segmented label="Eviction" value={cfg.policy} options={POLICIES.map((p) => ({ id: p.id, label: p.label, title: `Evicts ${p.evicts}` }))} onChange={(policy) => onPatch({ policy })} disabled={disabled} />;
    case 'skew':
      return <Range label="Popularity skew" value={cfg.skew} min={0} max={2} step={0.1} format={(v) => (v === 0 ? 'uniform' : v.toFixed(1))} onChange={(skew) => onPatch({ skew })} disabled={disabled} />;
    case 'pattern':
      return (
        <Segmented
          label="Traffic pattern"
          value={cfg.pattern}
          options={[
            { id: 'zipf', label: 'Popular keys' },
            { id: 'loop', label: 'Loop over keys' },
          ]}
          onChange={(pattern) => onPatch({ pattern })}
          disabled={disabled}
        />
      );
    case 'writeRatio':
      return <Range label="Writes" value={cfg.writeRatio} min={0} max={0.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(writeRatio) => onPatch({ writeRatio })} disabled={disabled} />;
    case 'strategy':
      return (
        <div className="space-y-1">
          <Segmented label="Write strategy" value={cfg.strategy} options={STRATEGIES.map((s) => ({ id: s.id, label: s.label, title: s.blurb }))} onChange={(strategy) => onPatch({ strategy })} disabled={disabled} />
          <p className="text-xs text-zinc-500">{STRATEGIES.find((s) => s.id === cfg.strategy)!.blurb}</p>
        </div>
      );
    case 'replica':
      return <Toggle label="Replica" title="Write-back only: copy each unflushed write to a second node before answering" on={cfg.replica} onChange={(replica) => onPatch({ replica })} disabled={disabled} />;
    case 'ttl':
      return <Range label="TTL" value={cfg.ttlSec} min={0} max={15} format={(v) => (v ? `${v} s` : 'none')} onChange={(ttlSec) => onPatch({ ttlSec })} disabled={disabled} />;
    case 'coalesce':
      return <Toggle label="Coalesce misses" title="One database fetch per missing key; other requests for it wait" on={cfg.coalesce} onChange={(coalesce) => onPatch({ coalesce })} disabled={disabled} />;
    case 'ttlJitter':
      return <Toggle label="TTL jitter" title="Each entry's TTL varies by ±30%" on={cfg.ttlJitter} onChange={(ttlJitter) => onPatch({ ttlJitter })} disabled={disabled} />;
    case 'refreshAhead':
      return <Toggle label="Refresh-ahead" title="Refresh entries that are still being read shortly before they expire" on={cfg.refreshAhead} onChange={(refreshAhead) => onPatch({ refreshAhead })} disabled={disabled} />;
    case 'dbCapacity':
      return <Range label="Database capacity" value={cfg.dbCapacity} min={2} max={20} format={(v) => `${v}/s`} onChange={(dbCapacity) => onPatch({ dbCapacity })} disabled={disabled} />;
    case 'view':
      return (
        <Segmented
          label="View"
          value={cfg.topology === 'fleet' ? 'fleet' : 'layers'}
          options={[
            { id: 'layers', label: 'Cache layers' },
            { id: 'fleet', label: 'Several app servers' },
          ]}
          onChange={(v) => onPatch({ topology: v })}
          disabled={disabled}
        />
      );
    case 'layers':
      if (cfg.topology !== 'layers') return null;
      return (
        <div className="flex flex-wrap gap-2">
          <Toggle label="Browser cache" on={cfg.layers.browser} onChange={(browser) => onPatch({ layers: { ...cfg.layers, browser } })} disabled={disabled} />
          <Toggle label="CDN edge" on={cfg.layers.cdn} onChange={(cdn) => onPatch({ layers: { ...cfg.layers, cdn } })} disabled={disabled} />
          <Toggle label="App cache" on={cfg.layers.app} onChange={(app) => onPatch({ layers: { ...cfg.layers, app } })} disabled={disabled} />
        </div>
      );
    case 'fleetMode':
      if (cfg.topology !== 'fleet') return null;
      return (
        <Segmented
          label="Cache"
          value={cfg.fleetMode}
          options={[
            { id: 'local', label: 'One per server', title: 'Each app server keeps its own 4-slot cache' },
            { id: 'global', label: 'One shared', title: 'All servers use one 12-slot cache' },
            { id: 'distributed', label: 'Distributed', title: 'Three 4-slot nodes; each key lives on one of them' },
          ]}
          onChange={(fleetMode) => onPatch({ fleetMode })}
          disabled={disabled}
        />
      );
  }
}
