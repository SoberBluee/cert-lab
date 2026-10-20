export interface SubnetInfo {
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  hostCount: number;
  mask: string;
}

export const CLIENT_IP = '192.168.1.10';

export function parseIpv4(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export const ipv4ToString = (n: number): string => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

const maskInt = (prefix: number) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

export function subnetInfo(ip: string, prefix: number): SubnetInfo | null {
  const n = parseIpv4(ip);
  if (n === null || prefix < 0 || prefix > 32) return null;
  const mask = maskInt(prefix);
  const network = (n & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const hostCount = prefix >= 31 ? 0 : 2 ** (32 - prefix) - 2;
  return {
    network: ipv4ToString(network),
    broadcast: ipv4ToString(broadcast),
    firstHost: ipv4ToString(prefix >= 31 ? network : network + 1),
    lastHost: ipv4ToString(prefix >= 31 ? broadcast : broadcast - 1),
    hostCount,
    mask: ipv4ToString(mask),
  };
}

export const isInSameSubnet = (a: string, b: string, prefix: number): boolean => {
  const x = parseIpv4(a);
  const y = parseIpv4(b);
  if (x === null || y === null) return false;
  const m = maskInt(prefix);
  return (x & m) === (y & m);
};

export interface TraceStep {
  from: string;
  to: string;
  label: string;
  detail: string;
}

/** Deterministic packet path for a destination, given the client's own subnet prefix. */
export function ipTrace(destination: string, prefix: number): TraceStep[] {
  if (parseIpv4(destination) === null) return [];
  if (isInSameSubnet(CLIENT_IP, destination, prefix)) {
    return [
      { from: 'Client', to: 'Client', label: 'Compare subnets', detail: `${destination} is inside ${CLIENT_IP}/${prefix}, so no router is needed.` },
      { from: 'Client', to: 'Server', label: 'ARP + direct frame', detail: 'The client finds the destination MAC on the local link and sends the frame directly.' },
      { from: 'Server', to: 'Client', label: 'Reply', detail: 'The reply also stays on the local network.' },
    ];
  }
  return [
    { from: 'Client', to: 'Client', label: 'Compare subnets', detail: `${destination} is outside ${CLIENT_IP}/${prefix}, so the packet goes to the default gateway.` },
    { from: 'Client', to: 'Gateway', label: `IP packet to ${destination}`, detail: 'The frame is addressed to the gateway MAC; the IP destination stays the server.' },
    { from: 'Gateway', to: 'Server', label: 'Routed packet', detail: 'The router decrements TTL, picks the next hop, and forwards toward the destination network.' },
    { from: 'Server', to: 'Gateway', label: 'Reply routed back', detail: 'Routers forward the reply toward 192.168.1.0/' + prefix + '.' },
    { from: 'Gateway', to: 'Client', label: 'Delivered', detail: 'The gateway delivers the reply on the local link.' },
  ];
}
