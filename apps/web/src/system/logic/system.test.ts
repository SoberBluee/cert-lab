import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dnsSteps } from './dns';
import { ipTrace, isInSameSubnet, parseIpv4, subnetInfo } from './ip';
import { assignments, countsOf, DEFAULT_BACKENDS } from './lb';
import { OSI_LAYERS, osiJourney } from './osi';
import { flowSteps } from './tcpudp';

describe('ip', () => {
  it('parses and rejects IPv4', () => {
    assert.notEqual(parseIpv4('192.168.1.10'), null);
    assert.equal(parseIpv4('999.1.1.1'), null);
    assert.equal(parseIpv4('192.168.1'), null);
  });
  it('computes subnets', () => {
    const info = subnetInfo('192.168.1.10', 24)!;
    assert.equal(info.network, '192.168.1.0');
    assert.equal(info.broadcast, '192.168.1.255');
    assert.equal(info.hostCount, 254);
    assert.equal(subnetInfo('10.0.0.77', 25)!.network, '10.0.0.0');
    assert.equal(subnetInfo('10.0.0.200', 25)!.network, '10.0.0.128');
  });
  it('routes local directly and remote via gateway', () => {
    assert.equal(isInSameSubnet('192.168.1.10', '192.168.1.25', 24), true);
    assert.equal(ipTrace('192.168.1.25', 24).some((s) => s.to === 'Gateway'), false);
    assert.equal(ipTrace('93.184.216.34', 24).some((s) => s.to === 'Gateway'), true);
    // Shrinking the prefix makes the same address remote.
    assert.equal(isInSameSubnet('192.168.1.10', '192.168.1.25', 28), false);
  });
});

describe('osi', () => {
  it('has 7 layers and a symmetric journey', () => {
    assert.equal(OSI_LAYERS.length, 7);
    assert.equal(OSI_LAYERS[0]!.name, 'Application');
    const steps = osiJourney();
    assert.equal(steps.length, 15);
    assert.equal(steps[0]!.side, 'sender');
    assert.equal(steps[steps.length - 1]!.side, 'receiver');
  });
});

describe('tcp/udp', () => {
  it('TCP handshakes and retransmits on loss', () => {
    const steps = flowSteps('tcp', true);
    assert.deepEqual(steps.slice(0, 3).map((s) => s.label), ['SYN', 'SYN-ACK', 'ACK']);
    assert.ok(steps.some((s) => s.label.includes('retransmit')));
  });
  it('UDP has no handshake and loses silently', () => {
    const steps = flowSteps('udp', true);
    assert.ok(!steps.some((s) => s.label === 'SYN'));
    assert.ok(steps.some((s) => s.lost));
    assert.ok(flowSteps('udp', false).every((s) => !s.label.includes('ACK')));
  });
});

describe('dns', () => {
  it('warm cache short-circuits, cold walks the chain', () => {
    const warm = dnsSteps('warm', 'A');
    assert.equal(warm.length, 2);
    assert.ok(warm[1]!.label.includes('HIT'));
    const cold = dnsSteps('cold', 'A');
    assert.ok(cold.some((s) => s.to === 'Root server'));
    assert.ok(cold.some((s) => s.to === 'Authoritative'));
    assert.ok(cold[cold.length - 1]!.label.includes('93.184.216.34'));
  });
  it('expired behaves like a miss and record types differ', () => {
    assert.ok(dnsSteps('expired', 'AAAA').some((s) => s.to === 'Root server'));
    assert.ok(dnsSteps('cold', 'CNAME').some((s) => s.label.includes('example.com')));
  });
});

describe('load balancing', () => {
  it('round-robin spreads evenly', () => {
    const ids = assignments('round-robin', DEFAULT_BACKENDS, 12);
    assert.deepEqual(countsOf(ids), { A: 4, B: 4, C: 4 });
  });
  it('weighted favours A, ip-hash sticks', () => {
    assert.equal(countsOf(assignments('weighted', DEFAULT_BACKENDS, 12)).A, 6);
    const hashed = assignments('ip-hash', DEFAULT_BACKENDS, 6);
    assert.ok(hashed.every((x) => x === hashed[0]));
  });
  it('unhealthy backends receive nothing', () => {
    const backends = DEFAULT_BACKENDS.map((b) => (b.id === 'B' ? { ...b, healthy: false } : b));
    assert.ok(!assignments('round-robin', backends, 10).includes('B'));
    assert.deepEqual(assignments('round-robin', backends.map((b) => ({ ...b, healthy: false })), 5), []);
  });
});
