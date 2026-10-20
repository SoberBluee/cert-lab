export interface OsiLayer {
  n: number;
  name: string;
  pdu: string;
  header: string;
  role: string;
  example: string;
  failure: string;
}

/** Top (7) to bottom (1). Original summaries. */
export const OSI_LAYERS: OsiLayer[] = [
  { n: 7, name: 'Application', pdu: 'Data', header: 'Application data', role: 'What the user-facing protocol means: requests, methods, status.', example: 'HTTP GET /index.html', failure: 'Wrong URL or method: the app answers 404.' },
  { n: 6, name: 'Presentation', pdu: 'Data', header: 'Encoding / encryption', role: 'How data is represented: encoding, compression, TLS encryption.', example: 'TLS, UTF-8, JSON encoding', failure: 'Encoding mismatch garbles text; TLS failure blocks the connection.' },
  { n: 5, name: 'Session', pdu: 'Data', header: 'Session markers', role: 'Opening, keeping and closing a dialogue between applications.', example: 'Session / connection reuse', failure: 'Session dropped: the app must re-authenticate or reconnect.' },
  { n: 4, name: 'Transport', pdu: 'Segment (TCP) / Datagram (UDP)', header: 'Source + destination port, sequence', role: 'Which process gets the data, and (for TCP) in what order, reliably.', example: 'TCP port 443, UDP port 53', failure: 'Wrong port or lost segments: nothing, or gaps, reach the app.' },
  { n: 3, name: 'Network', pdu: 'Packet', header: 'Source + destination IP', role: 'Which host, across networks: logical addressing and routing.', example: 'IP 93.184.216.34', failure: 'No route: the packet is dropped on the way.' },
  { n: 2, name: 'Data Link', pdu: 'Frame', header: 'Source + destination MAC', role: 'One hop on the local link: framing and local delivery.', example: 'Ethernet / Wi-Fi frame', failure: 'Bad frame check: the frame is discarded on this hop.' },
  { n: 1, name: 'Physical', pdu: 'Bits', header: '—', role: 'Moving raw bits: voltage, light, radio.', example: 'Cable, fibre, Wi-Fi radio', failure: 'Cable out: no bits move at all, every layer above fails.' },
];

export interface OsiStep {
  side: 'sender' | 'wire' | 'receiver';
  layer: number;
  label: string;
  detail: string;
}

/** Encapsulation down the sender, bits across, decapsulation up the receiver. */
export function osiJourney(): OsiStep[] {
  const down: OsiStep[] = OSI_LAYERS.map((l) => ({
    side: 'sender' as const,
    layer: l.n,
    label: `L${l.n} ${l.name}: ${l.pdu}`,
    detail:
      l.n === 1
        ? 'Bits go onto the wire / radio.'
        : `Adds ${l.header.toLowerCase()} — the payload becomes a ${l.pdu.toLowerCase()}.`,
  }));
  const up: OsiStep[] = [...OSI_LAYERS].reverse().map((l) => ({
    side: 'receiver' as const,
    layer: l.n,
    label: `L${l.n} ${l.name}: reads ${l.pdu}`,
    detail: l.n === 1 ? 'Bits arrive and are reassembled into frames.' : `Checks and removes the ${l.header.toLowerCase()}, passing the payload up.`,
  }));
  return [...down, { side: 'wire', layer: 1, label: 'On the wire', detail: 'Only bits travel; each hop re-does layers 1–3.' }, ...up];
}
