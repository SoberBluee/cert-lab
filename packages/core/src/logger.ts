import { join } from 'node:path';
import pino from 'pino';
import { dataDir } from './paths';

export type Logger = pino.Logger;

export const logFile = join(dataDir, 'logs', 'orchestrator.log');

export function createLogger(component: string): Logger {
  return pino(
    { level: process.env.CKA_LOG_LEVEL ?? 'debug', base: { component, pid: process.pid } },
    pino.destination({ dest: logFile, mkdir: true, sync: true }),
  );
}
