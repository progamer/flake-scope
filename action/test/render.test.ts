import { describe, expect, it } from 'vitest';
import type { FlakeReport } from '@flakescope/reporter';
import { mergeReports } from '../src/merge.js';
import { COMMENT_MARKER, escapeHtml, escapeMarkdown, inlineCode, render } from '../src/render.js';
import { loadFixture } from './helpers.js';

const mergeOne = (report: FlakeReport) => mergeReports([{ path: 'flake-report.json', report }]);

describe('render', () => {
  const regression = loadFixture('demo-regression.report.json');
  const result = mergeOne(regression);
  const md = render(result);

  it('starts with the hidden marker and heading', () => {
    expect(md.split('\n').slice(0, 2)).toEqual([COMMENT_MARKER, '### FlakeScope']);
  });

  it('summarizes counts and workers', () => {
    expect(md).toContain('**3 flaky · 1 failed · 8 tests · 4 workers**');
  });

  it('lists findings in verdict order, high confidence first', () => {
    const rows = md
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Verdict') && !l.startsWith('| ---'));
    expect(rows).toHaveLength(result.classifications.length);
    const order = ['Likely regression', 'Shared-state race', 'Env / resource', 'Known intermittent'];
    const ranks = rows.map((r) => order.findIndex((label) => r.includes(label)));
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    expect(rows[0]).toContain('cart total includes every item');
  });

  it('renders one details block per finding with evidence and checks', () => {
    expect(md.match(/<details>/g)).toHaveLength(result.classifications.length);
    expect(md).toContain('**Evidence**');
    expect(md).toContain('**Checked**');
    expect(md).toContain('`test-results/checkout-cart-total-includes-every-item-chromium/trace.zip`');
  });

  it('has the footer with commit, Playwright version and disclaimer', () => {
    expect(md).toContain('Commit `9a8b7c6`');
    expect(md).toContain('Playwright 1.63.0');
    expect(md).toContain('Verdicts are hypotheses from deterministic rules, not root causes.');
  });

  it('links the artifacts page only when CI info is available', () => {
    expect(md).not.toContain('#artifacts');
    const withCi = render(result, { serverUrl: 'https://github.com', repository: 'o/r', runId: '42' });
    expect(withCi).toContain('(https://github.com/o/r/actions/runs/42#artifacts)');
  });

  it('matches the snapshot for every fixture', () => {
    for (const name of [
      'demo-regression.report.json',
      'demo-linux-ci.report.json',
      'demo-windows-local.report.json',
      'edge-cases.report.json',
    ]) {
      expect(render(mergeOne(loadFixture(name)))).toMatchSnapshot(name);
    }
  });

  it('says so when nothing is flaky or failing', () => {
    const clean: FlakeReport = {
      ...regression,
      tests: [],
      summary: { ...regression.summary, unexpected: 0, flaky: 0, expected: 8, reported: 0 },
    };
    const out = render(mergeOne(clean));
    expect(out).toContain('No flaky or failing tests were found in 8 tests.');
    expect(out).not.toContain('<details>');
    expect(out.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('shows shard info for merged shards', () => {
    const shard = (current: number): FlakeReport => ({
      ...regression,
      run: { ...regression.run, shard: { current, total: 3 } },
    });
    const merged = mergeReports([
      { path: 'a', report: shard(1) },
      { path: 'b', report: shard(3) },
    ]);
    expect(render(merged)).toContain('2 of 3 shards (1, 3), 1 missing');
  });

  it('escapes Markdown and HTML in titles and evidence', () => {
    const hostile = structuredClone(regression);
    const test = hostile.tests.find((t) => t.outcome === 'unexpected')!;
    test.title = 'a | b <img src=x> *bold* @admin';
    test.titlePath = [test.title];
    const out = render(mergeOne(hostile));
    const row = out.split('\n').find((l) => l.includes('a \\| b'));
    expect(row).toBeDefined();
    expect(row).toContain('&lt;img src=x&gt;');
    expect(row).toContain('\\*bold\\*');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('@admin');
  });

  it('caps the body length and notes what was left out', () => {
    const big = structuredClone(regression);
    const template = big.tests.find((t) => t.outcome === 'flaky')!;
    big.tests = Array.from({ length: 400 }, (_, i) => ({
      ...structuredClone(template),
      id: `t${i}`,
      title: `test number ${i} ${'x'.repeat(100)}`,
      titlePath: [`test number ${i} ${'x'.repeat(100)}`],
    }));
    const out = render(mergeOne(big), { maxLength: 20_000 });
    expect(out.length).toBeLessThanOrEqual(20_000);
    expect(out).toMatch(/more tests not shown in detail/);
    expect(out).toContain('Verdicts are hypotheses');
  });
});

describe('escaping helpers', () => {
  it('escapeMarkdown', () => {
    expect(escapeMarkdown('a|b <c> `d` [e](f)\nnext')).toBe('a\\|b &lt;c&gt; \\`d\\` \\[e\\](f) next');
  });

  it('escapeHtml', () => {
    expect(escapeHtml('<b>"x" & y</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  });

  it('inlineCode picks a safe fence', () => {
    expect(inlineCode('a`b')).toBe('``a`b``');
    expect(inlineCode('plain')).toBe('`plain`');
  });
});
