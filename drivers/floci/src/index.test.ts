import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FLOCI_DEFAULT_ENDPOINT, FlociDriver, newAccountId, resolveEndpoint } from './index';

/** A driver with one session on disk, as createSession leaves it, so no Floci is needed. */
function withSession(accountId = '123456789012') {
  const dataDir = mkdtempSync(join(tmpdir(), 'floci-test-'));
  const dir = join(dataDir, 'aws', 's1');
  mkdirSync(join(dir, 'work'), { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ accountId }));
  return { driver: new FlociDriver({ dataDir, endpoint: 'http://127.0.0.1:4566' }), dir };
}

describe('resolveEndpoint', () => {
  it('defaults to Floci on localhost', () => {
    assert.equal(resolveEndpoint(undefined, false), FLOCI_DEFAULT_ENDPOINT);
    assert.equal(resolveEndpoint('http://127.0.0.1:4566/', false), 'http://127.0.0.1:4566');
  });

  it('refuses another machine unless allowed', () => {
    assert.throws(() => resolveEndpoint('https://ec2.us-east-1.amazonaws.com', false), /must point at this machine/);
    assert.equal(resolveEndpoint('http://floci.lan:4566', true), 'http://floci.lan:4566');
    assert.throws(() => resolveEndpoint('not a url', false), /is not a URL/);
  });
});

describe('FlociDriver', () => {
  it('rolls 12-digit accounts', () => {
    for (let i = 0; i < 50; i++) assert.match(newAccountId(), /^[1-9]\d{11}$/);
  });

  it('owns only the sessions it created', () => {
    const { driver } = withSession();
    assert.equal(driver.owns('s1'), true);
    assert.equal(driver.owns('other'), false);
  });

  it('runs commands with the session account and none of the user AWS settings', async () => {
    const { driver, dir } = withSession('210987654321');
    const saved = { ...process.env };
    process.env.AWS_PROFILE = 'production';
    process.env.AWS_SESSION_TOKEN = 'real-token';
    try {
      const r = await driver.exec('s1', 'controlplane', 'env | grep "^AWS_" | sort; pwd', { env: { NAME: 'x', KUBECONFIG: '/etc/kubernetes/admin.conf' } });
      assert.equal(r.exitCode, 0);
      assert.match(r.stdout, /^AWS_ACCESS_KEY_ID=210987654321$/m);
      assert.match(r.stdout, /^AWS_ENDPOINT_URL=http:\/\/127\.0\.0\.1:4566$/m);
      assert.ok(r.stdout.includes(`AWS_CONFIG_FILE=${join(dir, 'config')}\n`));
      assert.doesNotMatch(r.stdout, /AWS_PROFILE|AWS_SESSION_TOKEN/);
      assert.match(r.stdout, /\/work\n$/);
    } finally {
      process.env = saved;
    }
  });

  it('times out long commands', async () => {
    const { driver } = withSession();
    const r = await driver.exec('s1', 'controlplane', 'sleep 5', { timeoutMs: 200 });
    assert.equal(r.exitCode, 124);
    assert.match(r.stderr, /timed out/);
  });

  it('describes the connection with an export line for the user terminal', async () => {
    const { driver } = withSession('210987654321');
    const c = await driver.getConnectionInfo('s1');
    assert.equal(c.aws?.accountId, '210987654321');
    assert.match(c.aws!.exportLine, /^unset AWS_PROFILE AWS_SESSION_TOKEN; export AWS_ENDPOINT_URL=http:\/\/127\.0\.0\.1:4566 /);
    assert.deepEqual(c.nodes.map((n) => n.name), ['aws']);
  });
});
