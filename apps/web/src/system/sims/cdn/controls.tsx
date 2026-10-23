import type { CdnConfig } from '../../logic/cdn';
import { PROVIDERS, type ProviderId } from '../../logic/cdnMap';
import type { ControlId } from '../../logic/cdnLesson';
import { Range, Segmented, Toggle } from '../../stage/widgets';

const DNS_TTLS = [5, 10, 30, 60, 300] as const;

/** The widget for one CDN control, reading from and patching a config. */
export function Control({ id, cfg, onPatch, disabled }: { id: ControlId; cfg: CdnConfig; onPatch: (p: Partial<CdnConfig>) => void; disabled?: boolean }) {
  switch (id) {
    case 'cdnOn':
      return <Toggle label="CDN" on={cfg.cdnOn} onChange={(cdnOn) => onPatch({ cdnOn })} disabled={disabled} />;
    case 'pops':
      return (
        <p className="text-sm text-zinc-300">
          Edges on: <span className="font-mono">{cfg.pops.length}</span>
          {cfg.popBudget !== null && <span className="text-zinc-400"> of {cfg.popBudget} allowed</span>}
          <span className="text-xs text-zinc-500"> · click an edge on the map to switch it</span>
        </p>
      );
    case 'provider':
      return (
        <Segmented
          label="Provider"
          value={cfg.provider}
          options={(Object.keys(PROVIDERS) as ProviderId[]).map((p) => ({ id: p, label: p === 'global' ? 'Global' : 'Budget', title: PROVIDERS[p].label }))}
          onChange={(provider) => onPatch({ provider, pops: [...PROVIDERS[provider].pops] })}
          disabled={disabled}
        />
      );
    case 'handshakes':
      return <Toggle label="Count handshakes" title="Each new connection costs TCP and TLS round trips to whoever it connects to" on={cfg.handshakes} onChange={(handshakes) => onPatch({ handshakes })} disabled={disabled} />;
    case 'ttl':
      return <Range label="Edge TTL" value={cfg.ttlSec} min={1} max={120} format={(v) => `${v} s`} onChange={(ttlSec) => onPatch({ ttlSec })} disabled={disabled} />;
    case 'revalidate':
      return <Toggle label="Revalidate" title="When a copy expires, ask the origin whether it changed (a 304 if not)" on={cfg.revalidate} onChange={(revalidate) => onPatch({ revalidate })} disabled={disabled} />;
    case 'shield':
      return <Toggle label="Origin shield" title="One shared cache in front of the origin that every edge fetches through" on={cfg.shield} onChange={(shield) => onPatch({ shield })} disabled={disabled} />;
    case 'mode':
      return (
        <Segmented
          label="Delivery"
          value={cfg.mode}
          options={[
            { id: 'pull', label: 'Pull', title: 'Edges fetch a file the first time someone asks for it' },
            { id: 'push', label: 'Push', title: 'You upload every file to every edge up front' },
          ]}
          onChange={(mode) => onPatch({ mode })}
          disabled={disabled}
        />
      );
    case 'versioned':
      return <Toggle label="Versioned file names" title="Each deploy ships app.vN.js, a new URL" on={cfg.versioned} onChange={(versioned) => onPatch({ versioned })} disabled={disabled} />;
    case 'purge':
      return <Toggle label="Purge on deploy" title="Tell every edge to drop its copy of a file when it changes" on={cfg.purgeOnDeploy} onChange={(purgeOnDeploy) => onPatch({ purgeOnDeploy })} disabled={disabled} />;
    case 'rule':
      return (
        <Segmented
          label="Edges cache"
          value={cfg.rule}
          options={[
            { id: 'all', label: 'Everything', title: 'Every response, by URL' },
            { id: 'static', label: 'Static files', title: 'Logos, scripts and video; everything else passes through' },
            { id: 'headers', label: 'Per Cache-Control', title: 'What each response allows: static for the TTL, prices for 2 s, carts never' },
          ]}
          onChange={(rule) => onPatch({ rule })}
          disabled={disabled}
        />
      );
    case 'steering':
      return (
        <Segmented
          label="Users find an edge by"
          value={cfg.steering}
          options={[
            { id: 'anycast', label: 'Anycast', title: 'The network routes them to the nearest healthy edge' },
            { id: 'dns', label: 'DNS', title: 'They look it up and keep the answer for the DNS TTL' },
          ]}
          onChange={(steering) => onPatch({ steering })}
          disabled={disabled}
        />
      );
    case 'dnsTtl':
      if (cfg.steering !== 'dns') return null;
      return (
        <Segmented
          label="DNS TTL"
          value={String(cfg.dnsTtlSec)}
          options={DNS_TTLS.map((t) => ({ id: String(t), label: `${t} s` }))}
          onChange={(v) => onPatch({ dnsTtlSec: Number(v) })}
          disabled={disabled}
        />
      );
    case 'catalog':
      return (
        <Segmented
          label="Site"
          value={cfg.catalog}
          options={[
            { id: 'site', label: 'Web shop', title: 'Logo, app.js, 20 video segments, prices and a cart' },
            { id: 'docs', label: 'Docs site', title: '20 small pages' },
            { id: 'video', label: 'Video library', title: '2,000 video segments with a long tail' },
          ]}
          onChange={(catalog) => onPatch({ catalog })}
          disabled={disabled}
        />
      );
    case 'rps':
      return <Range label="Requests per city" value={cfg.rps} min={0.2} max={3} step={0.1} format={(v) => `${v.toFixed(1)}/s`} onChange={(rps) => onPatch({ rps })} disabled={disabled} />;
  }
}
