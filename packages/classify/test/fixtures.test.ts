import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlakeReport } from '@codept/flakescope-reporter';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T;

type Expected = Record<string, { verdict: string; confidence: string }>;

/** `demo-*.report.json` share `demo.expected.json`; `<name>.report.json` otherwise uses `<name>.expected.json`. */
function expectedFor(reportFile: string): Expected {
  const name = reportFile.replace(/\.report\.json$/, '');
  return load<Expected>(name.startsWith('demo-') ? 'demo.expected.json' : `${name}.expected.json`);
}

const reports = readdirSync(dir).filter((f) => f.endsWith('.report.json'));

describe.each(reports)('%s', (file) => {
  const report = load<FlakeReport>(file);
  const expected = expectedFor(file);
  const result = classify(report);

  it('classifies every flaky or failing test', () => {
    const relevant = report.tests.filter((t) => t.outcome === 'flaky' || t.outcome === 'unexpected');
    expect(result.classifications).toHaveLength(relevant.length);
  });

  it.each(result.classifications.map((c) => [c.title, c] as const))('%s', (title, c) => {
    const want = expected[title];
    expect(want, `no expectation for "${title}" in fixtures`).toBeDefined();
    expect({ verdict: c.verdict, confidence: c.confidence }).toEqual(want);
    expect(c.evidence.length).toBeGreaterThan(0);
    expect(c.checked).toHaveLength(3);
  });

  it('summary counts match the classifications', () => {
    const total = Object.entries(result.summary)
      .filter(([k]) => k !== 'classified')
      .reduce((n, [, v]) => n + v, 0);
    expect(total).toBe(result.summary.classified);
  });
});
