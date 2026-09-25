import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlakeReport } from '@flakescope/reporter';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/index.js';

const fixture = (name: string): FlakeReport =>
  JSON.parse(
    readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', name), 'utf8'),
  ) as FlakeReport;

const byTitle = (report: FlakeReport, title: string) => {
  const c = classify(report).classifications.find((x) => x.title === title);
  if (!c) throw new Error(`no classification for ${title}`);
  return c;
};

describe('classify', () => {
  it('rejects unknown report schema versions instead of guessing', () => {
    const report = { ...fixture('demo-linux-ci.report.json'), schemaVersion: 2 } as unknown as FlakeReport;
    expect(() => classify(report)).toThrow(/schemaVersion 2/);
  });

  it('carries run context for consumers', () => {
    const result = classify(fixture('demo-linux-ci.report.json'));
    expect(result.report.workers).toBe(4);
    expect(result.report.ci?.provider).toBe('github-actions');
    expect(result.summary).toMatchObject({
      classified: 3,
      'shared-state-race': 1,
      'env-resource': 1,
      'known-intermittent': 1,
    });
  });

  it('race evidence names the overlapping test, workers, and the shared resource', () => {
    const c = byTitle(fixture('demo-windows-local.report.json'), 'renames the profile to Alice B');
    expect(c.evidence[0]).toMatch(/Attempt 0 \(worker \d+\) overlapped "renames the profile to Alice A"/);
    expect(c.evidence[0]).toContain('account:alice');
    expect(c.evidence.some((line) => /Attempt 1 passed with no concurrent test sharing a resource/.test(line))).toBe(
      true,
    );
  });

  it('env evidence includes the timeout and the cold-start duration comparison', () => {
    const c = byTitle(fixture('demo-linux-ci.report.json'), 'dashboard loads');
    expect(c.evidence.join(' ')).toMatch(/Test timeout of 5000ms exceeded/);
    expect(c.evidence.join(' ')).toMatch(/x faster/);
  });

  it('a known-intermittent verdict shows what was checked and found nothing', () => {
    const c = byTitle(fixture('demo-linux-ci.report.json'), 'search results are sorted');
    expect(c.confidence).toBe('low');
    expect(c.checked.join(' ')).toMatch(/shared resources/);
    expect(c.checked.join(' ')).toMatch(/timeouts, connection errors/);
    expect(c.checked.join(' ')).toMatch(/same error/);
  });

  it('keeps losing signals visible', () => {
    const edge = fixture('edge-cases.report.json');
    expect(byTitle(edge, 'timeout during explicit race').alsoObserved.join(' ')).toMatch(/^env-resource \(medium\)/);
    expect(byTitle(edge, 'consistent timeout on every attempt').alsoObserved.join(' ')).toMatch(
      /env-resource \(medium\)/,
    );
    expect(byTitle(edge, 'failed alongside others, passed alone').alsoObserved.join(' ')).toMatch(
      /shared-state-race \(low\).*no shared resource was declared/,
    );
    expect(byTitle(edge, 'slow first attempt without timeout').alsoObserved.join(' ')).toMatch(/env-resource \(low\)/);
  });

  it('regression evidence says when the full message was identical', () => {
    const c = byTitle(fixture('demo-regression.report.json'), 'cart total includes every item');
    expect(c.evidence).toContain('The full error message was identical on every attempt.');
  });
});
