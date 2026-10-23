import type { Compression, ProxyConfig, TlsMode } from '../../logic/proxy';
import type { ControlId } from '../../logic/proxyLesson';
import { ADDR, type Country } from '../../logic/proxyMap';
import { Segmented, Toggle } from '../../stage/widgets';

const CANT_READ = 'TLS passes straight through, so the proxy can’t read the request';
const RATE_LIMITS = ['off', '1', '3', '10'] as const;

/** Who an address belongs to, for the blocklist. */
export const addressOwner = (addr: string) => (addr === ADDR.scraper ? 'the scraper' : Object.values(ADDR.egress).includes(addr) ? 'the office’s proxy' : 'an office laptop');

/** The widget for one proxy control, reading from and patching a config. */
export function Control({ id, cfg, onPatch, disabled }: { id: ControlId; cfg: ProxyConfig; onPatch: (p: Partial<ProxyConfig>) => void; disabled?: boolean }) {
  const reads = cfg.tls !== 'passthrough';
  const noShop = disabled || !cfg.revOn;
  switch (id) {
    case 'fwdOn':
      return <Toggle label="Forward proxy" title="The office’s laptops send everything through it" on={cfg.fwdOn} onChange={(fwdOn) => onPatch({ fwdOn })} disabled={disabled} />;
    case 'transparent':
      return <Toggle label="Adds X-Forwarded-For" title="Transparent mode: the proxy tells every site which laptop asked" on={cfg.transparent} onChange={(transparent) => onPatch({ transparent })} disabled={disabled || !cfg.fwdOn} />;
    case 'egress':
      return (
        <Segmented<Country>
          label="Exits in"
          value={cfg.egress}
          options={[
            { id: 'de', label: 'Germany' },
            { id: 'uk', label: 'UK' },
            { id: 'us', label: 'US' },
          ]}
          onChange={(egress) => onPatch({ egress })}
          disabled={disabled || !cfg.fwdOn}
        />
      );
    case 'filter':
      return <Toggle label="Filter" title="Refuse requests to blocked.example" on={cfg.filter} onChange={(filter) => onPatch({ filter })} disabled={disabled || !cfg.fwdOn} />;
    case 'revOn':
      return <Toggle label="Reverse proxy" title="shop.example points at the proxy instead of at every app server" on={cfg.revOn} onChange={(revOn) => onPatch({ revOn })} disabled={disabled} />;
    case 'routes':
      return <Toggle label="Route /static to the file store" title={reads ? undefined : CANT_READ} on={cfg.routes} onChange={(routes) => onPatch({ routes })} disabled={noShop || !reads} />;
    case 'backends':
      return <Segmented label="App servers" value={String(cfg.backends)} options={['1', '2', '3'].map((v) => ({ id: v, label: v }))} onChange={(v) => onPatch({ backends: Number(v) as 1 | 2 | 3 })} disabled={disabled} />;
    case 'tls':
      return (
        <Segmented<TlsMode>
          label="TLS"
          value={cfg.tls}
          options={[
            { id: 'terminate', label: 'Ends at proxy', title: 'The proxy decrypts; plain HTTP inside the data centre' },
            { id: 'reencrypt', label: 'Re-encrypt', title: 'The proxy decrypts and reads, then encrypts again to the app servers' },
            { id: 'passthrough', label: 'Pass through', title: 'The proxy forwards encrypted bytes it can’t read' },
          ]}
          onChange={(tls) => onPatch({ tls })}
          disabled={noShop}
        />
      );
    case 'compression':
      return (
        <Segmented<Compression>
          label="gzip"
          value={cfg.compression}
          options={[
            { id: 'off', label: 'Off' },
            { id: 'backend', label: 'App servers', title: 'Each app server compresses its own responses' },
            { id: 'proxy', label: 'Proxy', title: reads ? 'The proxy compresses responses on the way out' : CANT_READ },
          ]}
          onChange={(compression) => onPatch({ compression })}
          disabled={disabled}
        />
      );
    case 'cache':
      return <Toggle label="Cache at the proxy" title={reads ? `Keep /, /api/catalog and /static/* for ${cfg.cacheTtlSec} s; never /cart` : CANT_READ} on={cfg.cache} onChange={(cache) => onPatch({ cache })} disabled={noShop || !reads} />;
    case 'rateLimit':
      return (
        <Segmented
          label="Limit per address"
          value={cfg.rateLimit === null ? 'off' : String(cfg.rateLimit)}
          options={RATE_LIMITS.map((v) => ({ id: v, label: v === 'off' ? 'Off' : `${v}/s` }))}
          onChange={(v) => onPatch({ rateLimit: v === 'off' ? null : Number(v) })}
          disabled={noShop}
        />
      );
    case 'blocklist':
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
          <span>Blocked</span>
          {cfg.blocklist.length === 0 && <span className="text-xs text-zinc-500">nobody</span>}
          {cfg.blocklist.map((a) => (
            <button
              key={a}
              type="button"
              className="rounded-md border border-red-900 bg-red-950/40 px-2 py-0.5 font-mono text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-50"
              title={`Unblock ${addressOwner(a)}`}
              onClick={() => onPatch({ blocklist: cfg.blocklist.filter((x) => x !== a) })}
              disabled={noShop}
            >
              {a} ✕
            </button>
          ))}
          <span className="text-xs text-zinc-500">· click a client on the stage to block its address</span>
        </div>
      );
    case 'standby':
      return <Toggle label="Standby proxy" title="A second proxy that takes over the shop’s address when the first dies" on={cfg.standby} onChange={(standby) => onPatch({ standby })} disabled={noShop} />;
    case 'healthCheck':
      return (
        <Segmented
          label="Health check every"
          value={String(cfg.healthCheckSec)}
          options={['1', '3', '10'].map((v) => ({ id: v, label: `${v} s` }))}
          onChange={(v) => onPatch({ healthCheckSec: Number(v) })}
          disabled={noShop || !cfg.standby}
        />
      );
    case 'traffic':
      return (
        <>
          <Segmented label="Each laptop" value={String(cfg.officeRps)} options={['0.6', '1.5'].map((v) => ({ id: v, label: `${v}/s` }))} onChange={(v) => onPatch({ officeRps: Number(v) })} disabled={disabled} />
          <Segmented label="Each customer" value={String(cfg.customerRps)} options={['0.4', '1', '2'].map((v) => ({ id: v, label: `${v}/s` }))} onChange={(v) => onPatch({ customerRps: Number(v) })} disabled={disabled} />
          <Segmented label="Scraper" value={String(cfg.scraperRps)} options={['4', '6', '20', '40'].map((v) => ({ id: v, label: `${v}/s` }))} onChange={(v) => onPatch({ scraperRps: Number(v) })} disabled={disabled} />
        </>
      );
  }
}
