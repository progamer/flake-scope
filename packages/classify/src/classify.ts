import type { FlakeReport, ReportedTest } from '@codept/flakescope-reporter';
import { describeError } from './errors.js';
import { envRule, isFailed, raceRule, regressionRule } from './rules.js';
import {
  CLASSIFICATION_SCHEMA_VERSION,
  type Classification,
  type ClassificationResult,
  type Confidence,
  type Signal,
  type Verdict,
} from './types.js';

export const SUPPORTED_REPORT_SCHEMA_VERSION = 1;

const CONFIDENCE: Record<number, Confidence> = { 1: 'low', 2: 'medium', 3: 'high' };

/** Tie-break order when two signals are equally strong. */
const PRIORITY: Verdict[] = ['likely-regression', 'shared-state-race', 'env-resource', 'known-intermittent'];

const RULES = [regressionRule, raceRule, envRule];

export function classifyTest(test: ReportedTest): Classification | null {
  if (test.outcome !== 'flaky' && test.outcome !== 'unexpected') return null;

  const results = RULES.map((rule) => rule(test));
  const signals = results.flatMap((r) => r.signals);
  const checked = results.map((r) => `Checked ${r.checked}.`);

  // Only medium or strong signals can decide a verdict. Weak ones are reported, not trusted.
  const decisive = signals
    .filter((s) => s.strength >= 2)
    .sort((a, b) => b.strength - a.strength || PRIORITY.indexOf(a.verdict) - PRIORITY.indexOf(b.verdict));

  let winner: Signal | undefined = decisive[0];
  if (!winner) winner = fallback(test, signals);

  const alsoObserved = signals
    .filter((s) => s !== winner)
    .map((s) => `${s.verdict} (${CONFIDENCE[s.strength]}): ${s.evidence.join(' ')}`);

  return {
    testId: test.id,
    title: test.title,
    titlePath: test.titlePath,
    file: test.file,
    line: test.line,
    project: test.project,
    outcome: test.outcome,
    verdict: winner.verdict,
    confidence: CONFIDENCE[winner.strength] as Confidence,
    evidence: winner.evidence,
    alsoObserved,
    checked,
  };
}

/**
 * Nothing decisive. A test that never passed stays a (low-confidence) regression; a test
 * that passed on retry is a known intermittent. Either way, confidence is low.
 */
function fallback(test: ReportedTest, signals: Signal[]): Signal {
  if (test.outcome === 'unexpected') {
    const weak = signals.find((s) => s.verdict === 'likely-regression');
    if (weak) return weak;
    return {
      verdict: 'likely-regression',
      strength: 1,
      evidence: ['The test did not pass on any attempt, but the attempts do not agree on one error.'],
    };
  }

  const firstFail = test.attempts.find(isFailed);
  const pass = test.attempts.find((a) => a.status === 'passed');
  const evidence: string[] = [];
  if (firstFail) evidence.push(`Attempt ${firstFail.retry} failed with ${describeError(firstFail)}.`);
  if (pass) evidence.push(`Attempt ${pass.retry} passed.`);
  evidence.push('No shared resource, environment error, or consistent failure pattern explains the difference.');
  return { verdict: 'known-intermittent', strength: 1, evidence };
}

export function classify(report: FlakeReport): ClassificationResult {
  if (report.schemaVersion !== SUPPORTED_REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported flake-report schemaVersion ${String(report.schemaVersion)} ` +
        `(this classifier reads version ${SUPPORTED_REPORT_SCHEMA_VERSION}).`,
    );
  }

  const classifications = report.tests.map(classifyTest).filter((c): c is Classification => c !== null);
  const summary = {
    classified: classifications.length,
    'likely-regression': 0,
    'shared-state-race': 0,
    'env-resource': 0,
    'known-intermittent': 0,
  };
  for (const c of classifications) summary[c.verdict]++;

  return {
    schemaVersion: CLASSIFICATION_SCHEMA_VERSION,
    report: {
      schemaVersion: report.schemaVersion,
      generator: report.generator,
      workers: report.run.workers,
      shard: report.run.shard,
      git: report.git,
      ci: report.ci,
    },
    summary,
    classifications,
  };
}
