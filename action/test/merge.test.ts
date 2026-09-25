import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findReports, parsePatterns } from '../src/find.js';
import { mergeReports, parseReport } from '../src/merge.js';
import { loadFixture } from './helpers.js';

describe('parsePatterns', () => {
  it('splits lines and drops blanks and comments', () => {
    expect(parsePatterns('a/*.json\n\n  # note\r\n b/**/x.json  ')).toEqual(['a/*.json', 'b/**/x.json']);
  });
});

describe('findReports', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'flakescope-find-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  for (const dir of ['shard-1', 'shard-2', 'node_modules/pkg', 'a/node_modules/b']) {
    mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, dir, 'flake-report.json'), '{}');
  }

  it('finds reports and skips node_modules', () => {
    expect(findReports(['**/flake-report.json'], root)).toEqual([
      'shard-1/flake-report.json',
      'shard-2/flake-report.json',
    ]);
  });

  it('deduplicates across patterns and accepts literal paths', () => {
    expect(findReports(['shard-1/flake-report.json', 'shard-*/flake-report.json'], root)).toEqual([
      'shard-1/flake-report.json',
      'shard-2/flake-report.json',
    ]);
  });

  it('returns nothing when no file matches', () => {
    expect(findReports(['missing/*.json'], root)).toEqual([]);
  });
});

describe('parseReport', () => {
  it('rejects invalid JSON', () => {
    expect(parseReport('{', 'x.json')).toHaveProperty('error', expect.stringContaining('not valid JSON'));
  });

  it('rejects an unsupported schemaVersion', () => {
    const report = { ...loadFixture('demo-regression.report.json'), schemaVersion: 99 };
    expect(parseReport(JSON.stringify(report), 'x.json')).toHaveProperty(
      'error',
      expect.stringContaining('schemaVersion 99'),
    );
  });

  it('accepts a supported report', () => {
    const text = JSON.stringify(loadFixture('demo-regression.report.json'));
    expect(parseReport(text, 'x.json')).toHaveProperty('report');
  });
});

describe('mergeReports', () => {
  const a = loadFixture('demo-regression.report.json');
  const b = loadFixture('edge-cases.report.json');

  it('sums counts and concatenates classifications across shards', () => {
    const merged = mergeReports([
      { path: 'a.json', report: a },
      { path: 'b.json', report: b },
    ]);
    const single = [mergeReports([{ path: 'a.json', report: a }]), mergeReports([{ path: 'b.json', report: b }])];
    expect(merged.reports.map((r) => r.path)).toEqual(['a.json', 'b.json']);
    expect(merged.summary.total).toBe(a.summary.total + b.summary.total);
    expect(merged.summary.flaky).toBe(a.summary.flaky + b.summary.flaky);
    expect(merged.summary.unexpected).toBe(a.summary.unexpected + b.summary.unexpected);
    expect(merged.classifications).toHaveLength(single[0]!.classifications.length + single[1]!.classifications.length);
    expect(merged.summary.classified).toBe(merged.classifications.length);
    expect(merged.classifications.filter((c) => c.report === 1)).toHaveLength(single[1]!.classifications.length);
  });

  it('collects trace and screenshot paths from failing attempts', () => {
    const merged = mergeReports([{ path: 'a.json', report: a }]);
    const regression = merged.classifications.find((c) => c.verdict === 'likely-regression');
    expect(regression?.attachments.length).toBeGreaterThan(0);
    expect(regression?.attachments.every((p) => p.endsWith('trace.zip') || p.endsWith('.png'))).toBe(true);
  });
});
