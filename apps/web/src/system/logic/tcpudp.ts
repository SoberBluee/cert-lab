export type Protocol = 'tcp' | 'udp';

export interface FlowStep {
  from: 'Client' | 'Server';
  to: 'Client' | 'Server';
  label: string;
  detail: string;
  lost?: boolean;
}

/**
 * Three segments of application data. `dropSecond` loses segment 2 once:
 * TCP notices (no ACK) and retransmits; UDP never notices.
 */
export function flowSteps(protocol: Protocol, dropSecond: boolean): FlowStep[] {
  if (protocol === 'udp') {
    return [
      { from: 'Client', to: 'Server', label: 'Datagram 1', detail: 'No handshake: the client just sends. Each datagram is independent.' },
      dropSecond
        ? { from: 'Client', to: 'Server', label: 'Datagram 2 — lost', detail: 'Dropped on the way. Nobody is told: no ACK, no retransmission.', lost: true }
        : { from: 'Client', to: 'Server', label: 'Datagram 2', detail: 'Arrives (this time). UDP does not promise it will.' },
      { from: 'Client', to: 'Server', label: 'Datagram 3', detail: 'May even arrive before a delayed datagram 2 — UDP keeps no order.' },
      { from: 'Server', to: 'Client', label: 'Done (maybe)', detail: dropSecond ? 'The app received 1 and 3. If it needed 2, the app itself must cope.' : 'The app received all three — by luck of this run, not by guarantee.' },
    ];
  }
  const steps: FlowStep[] = [
    { from: 'Client', to: 'Server', label: 'SYN', detail: 'Handshake 1/3: "Can we talk? My sequence starts here."' },
    { from: 'Server', to: 'Client', label: 'SYN-ACK', detail: 'Handshake 2/3: "Yes — and mine starts here."' },
    { from: 'Client', to: 'Server', label: 'ACK', detail: 'Handshake 3/3: connection open. This cost a round trip before any data.' },
    { from: 'Client', to: 'Server', label: 'Segment 1', detail: 'Data with a sequence number.' },
    { from: 'Server', to: 'Client', label: 'ACK 1', detail: 'Received, in order.' },
  ];
  if (dropSecond) {
    steps.push(
      { from: 'Client', to: 'Server', label: 'Segment 2 — lost', detail: 'Dropped on the way.', lost: true },
      { from: 'Client', to: 'Server', label: 'Segment 2 (retransmit)', detail: 'No ACK arrived, so after a timeout TCP sends it again. Slower, but nothing is missing.' },
      { from: 'Server', to: 'Client', label: 'ACK 2', detail: 'Received now.' },
    );
  } else {
    steps.push(
      { from: 'Client', to: 'Server', label: 'Segment 2', detail: 'Next in sequence.' },
      { from: 'Server', to: 'Client', label: 'ACK 2', detail: 'Received, in order.' },
    );
  }
  steps.push(
    { from: 'Client', to: 'Server', label: 'Segment 3', detail: 'Delivered to the app only after 1 and 2 — order is part of the deal.' },
    { from: 'Server', to: 'Client', label: 'ACK 3', detail: 'Everything arrived, in order. TCP paid for this with ACKs, state and retransmission delay.' },
  );
  return steps;
}
