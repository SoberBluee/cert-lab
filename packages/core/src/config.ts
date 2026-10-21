import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './paths';

/** The Kubernetes versions the lab images are built with, from config/versions.yaml. */
export interface LabVersions {
  /** The cluster version, e.g. 1.37.1. */
  current: string;
  /** The minor the upgrade questions start from, e.g. 1.36. */
  previous: string;
}

let cached: LabVersions | undefined;

export function labVersions(): LabVersions {
  if (cached) return cached;
  let text = '';
  try {
    text = readFileSync(join(repoRoot, 'config', 'versions.yaml'), 'utf8');
  } catch {
    // Without the repository config (tests elsewhere), fall back to what the images were built with.
  }
  const get = (key: string) => new RegExp(`^${key}:\\s*"?([^"#\\s]+)"?`, 'm').exec(text)?.[1];
  cached = { current: get('kubernetesVersion') ?? '1.37.1', previous: get('kubernetesPreviousVersion') ?? '1.36' };
  return cached;
}
