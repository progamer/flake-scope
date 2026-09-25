import { describe, expect, it } from 'vitest';
import { findConcurrent, type AttemptRecord } from '../src/concurrency.js';

function attempt(
  overrides: Partial<AttemptRecord> & Pick<AttemptRecord, 'testId' | 'startMs' | 'endMs'>,
): AttemptRecord {
  return {
    title: overrides.testId,
    file: 'a.spec.ts',
    project: 'chromium',
    resources: [],
    retry: 0,
    status: 'passed',
    workerIndex: 0,
    parallelIndex: 0,
    ...overrides,
  };
}

describe('findConcurrent', () => {
  const target = attempt({ testId: 't', workerIndex: 0, startMs: 1000, endMs: 2000, resources: ['account:alice'] });

  it('finds overlapping attempts on other workers', () => {
    const other = attempt({ testId: 'o', workerIndex: 1, parallelIndex: 1, startMs: 1500, endMs: 2500 });
    const { concurrent } = findConcurrent(target, [target, other]);
    expect(concurrent).toHaveLength(1);
    expect(concurrent[0]).toMatchObject({ testId: 'o', overlapMs: 500, workerIndex: 1, sharedResources: [] });
  });

  it('ignores the same test, the same worker, non-overlapping and never-run attempts', () => {
    const all = [
      target,
      attempt({ testId: 't', retry: 1, workerIndex: 2, startMs: 1200, endMs: 1300 }), // own retry
      attempt({ testId: 'same-worker', workerIndex: 0, startMs: 1100, endMs: 1200 }),
      attempt({ testId: 'before', workerIndex: 1, startMs: 0, endMs: 1000 }), // touches, no overlap
      attempt({ testId: 'after', workerIndex: 1, startMs: 2000, endMs: 3000 }),
      attempt({ testId: 'never-ran', workerIndex: -1, startMs: 1000, endMs: 2000 }),
    ];
    expect(findConcurrent(target, all).concurrent).toEqual([]);
  });

  it('reports shared resources and ranks them first', () => {
    const all = [
      target,
      attempt({ testId: 'long', workerIndex: 1, startMs: 1000, endMs: 2000 }),
      attempt({ testId: 'shares', workerIndex: 2, startMs: 1900, endMs: 2100, resources: ['account:alice', 'x'] }),
    ];
    const { concurrent } = findConcurrent(target, all);
    expect(concurrent.map((c) => c.testId)).toEqual(['shares', 'long']);
    expect(concurrent[0]?.sharedResources).toEqual(['account:alice']);
  });

  it('caps the list and flags truncation', () => {
    const others = Array.from({ length: 5 }, (_, i) =>
      attempt({ testId: `o${i}`, workerIndex: 1, startMs: 1000, endMs: 1100 + i * 100 }),
    );
    const { concurrent, truncated } = findConcurrent(target, [target, ...others], 3);
    expect(truncated).toBe(true);
    expect(concurrent.map((c) => c.testId)).toEqual(['o4', 'o3', 'o2']);
  });
});
