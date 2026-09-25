import { globSync } from 'node:fs';
import path from 'node:path';

const SKIPPED_DIRS = new Set(['node_modules', '.git']);

const toPosix = (p: string): string => p.replace(/\\/g, '/');

/** Splits a multi-line input into patterns, dropping blank lines and `#` comments. */
export function parsePatterns(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * Expands glob patterns relative to `cwd`. Never descends into `node_modules` or `.git`.
 * Returns unique posix-style paths (relative when the pattern was relative), sorted.
 */
export function findReports(patterns: string[], cwd: string = process.cwd()): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    const matches = globSync(toPosix(pattern), {
      cwd,
      exclude: (entry: string) => SKIPPED_DIRS.has(path.basename(entry)),
    });
    for (const match of matches) {
      const posix = toPosix(match);
      if (posix.split('/').some((segment) => SKIPPED_DIRS.has(segment))) continue;
      found.add(posix);
    }
  }
  return [...found].sort();
}
