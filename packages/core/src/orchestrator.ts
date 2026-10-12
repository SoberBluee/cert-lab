import { join } from 'node:path';
import type { Driver } from '@cka/schema';
import { FakeDriver } from '@cka/driver-fake';
import { MultipassDriver } from '@cka/driver-multipass';
import { TartDriver } from '@cka/driver-tart';
import { readImagesMeta, type DriverLog } from '@cka/driver-vm-common';
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

export const DRIVERS = ['fake', 'multipass', 'tart'] as const;
export type DriverName = (typeof DRIVERS)[number];

/** CKA_DRIVER wins; otherwise the backend the base images were built with, defaulting to multipass. */
export function selectDriverName(env: string | undefined = process.env.CKA_DRIVER, dir = dataDir): DriverName {
  const chosen = env || readImagesMeta(dir)?.driver || 'multipass';
  if (!(DRIVERS as readonly string[]).includes(chosen)) {
    throw new Error(`Unknown driver "${chosen}" (CKA_DRIVER or images.json). Use one of: ${DRIVERS.join(', ')}.`);
  }
  return chosen as DriverName;
}

/** Wires the driver, store, scenario library and session manager. CKA_DRIVER=fake simulates the lab. */
export function createOrchestrator(component: string): Orchestrator {
  const log = createLogger(component);
  const name = selectDriverName();
  const vmOpts = {
    dataDir,
    readyScriptPath: join(repoRoot, 'tools', 'build-base-images', 'cluster-ready.sh'),
    log: ((level, msg, extra) => log[level](extra ?? {}, msg)) as DriverLog,
  };
  const driver: Driver = name === 'fake' ? new FakeDriver() : name === 'tart' ? new TartDriver(vmOpts) : new MultipassDriver(vmOpts);
  const store = new Store(name === 'fake' ? join(dataDir, 'state-fake.db') : undefined);
  const library = new ScenarioLibrary();
  for (const e of library.errors) log.warn({ file: e.file, errors: e.messages }, 'invalid scenario skipped');
  const sessions = new SessionManager(driver, store, library, log);
  return { driver, store, library, sessions, log };
}
