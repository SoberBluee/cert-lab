import { join } from 'node:path';
import type { Driver } from '@cka/schema';
import { FakeDriver } from '@cka/driver-fake';
import { MultipassDriver } from '@cka/driver-multipass';
import { createLogger, type Logger } from './logger';
import { dataDir, repoRoot } from './paths';
import { ScenarioLibrary } from './scenarios';
import { SessionManager } from './session';
import { Store } from './store';

export interface Orchestrator {
  driver: Driver;
  store: Store;
  library: ScenarioLibrary;
  sessions: SessionManager;
  log: Logger;
}

/** Wires the driver, store, scenario library and session manager. CKA_DRIVER=fake simulates the lab. */
export function createOrchestrator(component: string): Orchestrator {
  const log = createLogger(component);
  const fake = process.env.CKA_DRIVER === 'fake';
  const driver: Driver = fake
    ? new FakeDriver()
    : new MultipassDriver({
        dataDir,
        readyScriptPath: join(repoRoot, 'tools', 'build-base-images', 'cluster-ready.sh'),
        log: (level, msg, extra) => log[level](extra ?? {}, msg),
      });
  const store = new Store(fake ? join(dataDir, 'state-fake.db') : undefined);
  const library = new ScenarioLibrary();
  for (const e of library.errors) log.warn({ file: e.file, errors: e.messages }, 'invalid scenario skipped');
  const sessions = new SessionManager(driver, store, library, log);
  return { driver, store, library, sessions, log };
}
