import type { AttemptStatus, ConcurrentAttempt } from './schema.js';

/** Minimal record of every attempt in the run, kept so overlaps can be computed at the end. */
export interface AttemptRecord {
  testId: string;
  title: string;
  file: string;
  project: string;
  resources: string[];
  retry: number;
  status: AttemptStatus;
  workerIndex: number;
  parallelIndex: number;
  startMs: number;
  endMs: number;
}

export const MAX_CONCURRENT = 50;

/**
 * Attempts of *other* tests that overlapped `target` in time on a different worker.
 * Sorted by shared resources first, then by overlap length.
 */
export function findConcurrent(
  target: AttemptRecord,
  all: readonly AttemptRecord[],
  limit = MAX_CONCURRENT,
): { concurrent: ConcurrentAttempt[]; truncated: boolean } {
  const matches: ConcurrentAttempt[] = [];
  const targetResources = new Set(target.resources);

  for (const other of all) {
    if (other.testId === target.testId) continue;
    if (other.workerIndex === target.workerIndex) continue; // same worker runs serially
    if (other.workerIndex < 0) continue; // never actually ran
    const overlapMs = Math.min(target.endMs, other.endMs) - Math.max(target.startMs, other.startMs);
    if (overlapMs <= 0) continue;
    matches.push({
      testId: other.testId,
      title: other.title,
      file: other.file,
      project: other.project,
      retry: other.retry,
      status: other.status,
      workerIndex: other.workerIndex,
      parallelIndex: other.parallelIndex,
      overlapMs: Math.round(overlapMs),
      sharedResources: other.resources.filter((r) => targetResources.has(r)),
    });
  }

  matches.sort(
    (a, b) =>
      b.sharedResources.length - a.sharedResources.length ||
      b.overlapMs - a.overlapMs ||
      a.testId.localeCompare(b.testId),
  );
  return { concurrent: matches.slice(0, limit), truncated: matches.length > limit };
}
