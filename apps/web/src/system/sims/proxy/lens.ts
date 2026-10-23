import type { ProxyScene } from '../../logic/proxy';
import { CUSTOMERS, LAPTOPS, SITES, type Laptop, type Site } from '../../logic/proxyMap';

/** Whose point of view the stage is drawn from. */
export type Viewer = 'everyone' | 'alice' | 'news' | 'customers' | 'app2';

export const VIEWERS: { id: Viewer; label: string }[] = [
  { id: 'everyone', label: 'Everyone' },
  { id: 'alice', label: 'Alice' },
  { id: 'news', label: 'news.example' },
  { id: 'customers', label: 'A customer' },
  { id: 'app2', label: 'app-2' },
];

export interface View {
  /** self: the viewer; known: the viewer has seen one of its addresses; unknown: no way to know it's there. */
  state: 'self' | 'known' | 'unknown';
  /** The address the viewer knows it by, when the lens is on. */
  address?: string;
  /** Whether the viewer also knows what it is (it chose to connect to it), or only its address. */
  named?: boolean;
}

/**
 * How `viewer` sees node `id`, from the envelopes it has actually received: a website knows a
 * client only by the source address (and any X-Forwarded-For) it was sent.
 */
export function viewOf(s: ProxyScene, viewer: Viewer, id: string): View {
  if (viewer === 'everyone') return { state: 'known' };
  if (id === viewer) return { state: 'self' };
  // People know the sites they type in by name, even when a proxy fetches them.
  if (LAPTOPS.includes(viewer as Laptop) && SITES.includes(id as Site)) return { state: 'known' };
  if (viewer === CUSTOMERS && id === CUSTOMERS) return { state: 'self' };
  const addr = s.knownAs(viewer, id);
  if (!addr) return { state: 'unknown' };
  // A party knows another by name only if it chose to connect to it; otherwise it's just an address.
  return { state: 'known', address: addr, named: viewer === CUSTOMERS || LAPTOPS.includes(viewer as Laptop) };
}
