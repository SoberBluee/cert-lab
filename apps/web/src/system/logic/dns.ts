export type CacheState = 'warm' | 'cold' | 'expired';
export type RecordType = 'A' | 'AAAA' | 'CNAME';

export const DNS_HOST = 'www.example.com';

export const ANSWERS: Record<RecordType, string> = {
  A: '93.184.216.34',
  AAAA: '2606:2800:220:1:248:1893:25c8:1946',
  CNAME: 'example.com',
};

export interface DnsStep {
  from: string;
  to: string;
  label: string;
  detail: string;
}

/** Resolution path; warm cache short-circuits, expired is treated as a miss with a note. */
export function dnsSteps(cache: CacheState, type: RecordType): DnsStep[] {
  const answer = ANSWERS[type];
  if (cache === 'warm') {
    return [
      { from: 'Browser', to: 'Browser cache', label: `Lookup ${DNS_HOST} ${type}`, detail: 'A still-valid cached answer exists (TTL not yet expired).' },
      { from: 'Browser cache', to: 'Browser', label: `HIT → ${answer}`, detail: 'No network lookup at all. Fast — but if the record changed, this answer is stale until the TTL runs out.' },
    ];
  }
  const first =
    cache === 'expired'
      ? { from: 'Browser', to: 'Browser cache', label: `Lookup ${DNS_HOST} ${type}`, detail: 'A cached answer exists but its TTL expired, so it must not be used. Full lookup needed.' }
      : { from: 'Browser', to: 'Browser cache', label: `Lookup ${DNS_HOST} ${type}`, detail: 'Nothing cached. Full lookup needed.' };
  return [
    first,
    { from: 'Browser', to: 'Recursive resolver', label: 'Ask resolver', detail: 'The stub resolver hands the whole job to a recursive resolver (ISP, or a public one).' },
    { from: 'Recursive resolver', to: 'Root server', label: 'Where is .com?', detail: 'The resolver starts at the root: it knows who runs each top-level domain.' },
    { from: 'Root server', to: 'Recursive resolver', label: 'Referral: .com TLD servers', detail: 'Not the answer — a referral to the .com servers.' },
    { from: 'Recursive resolver', to: 'TLD server', label: 'Where is example.com?', detail: 'Next referral level.' },
    { from: 'TLD server', to: 'Recursive resolver', label: 'Referral: example.com authoritative', detail: 'The servers that actually hold example.com records.' },
    { from: 'Recursive resolver', to: 'Authoritative', label: `Ask for ${DNS_HOST} ${type}`, detail: 'The source of truth for the zone.' },
    { from: 'Authoritative', to: 'Recursive resolver', label: `${type} → ${answer} (TTL 300)`, detail: 'Answer plus how long it may be cached.' },
    { from: 'Recursive resolver', to: 'Browser', label: `Answer → ${answer}`, detail: 'Both resolver and browser cache it for the TTL — the next lookup is a hit.' },
  ];
}
