import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlakeReport } from '@flakescope/reporter';

export const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'classify',
  'fixtures',
);

export function loadFixture(name: string): FlakeReport {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')) as FlakeReport;
}
