import type { FlakeReport, TestOutcome } from '@flakescope/reporter';

/** Result format. Same compatibility rule as flake-report.json: additive changes keep the version. */
export const CLASSIFICATION_SCHEMA_VERSION = 1 as const;

export type Verdict = 'likely-regression' | 'shared-state-race' | 'env-resource' | 'known-intermittent';
export type Confidence = 'low' | 'medium' | 'high';

export interface Classification {
  testId: string;
  title: string;
  titlePath: string[];
  file: string;
  line: number;
  project: string;
  outcome: Extract<TestOutcome, 'flaky' | 'unexpected'>;
  verdict: Verdict;
  confidence: Confidence;
  /** Facts that produced the verdict. Each names the attempt, worker, resource, or location it came from. */
  evidence: string[];
  /** Signals that pointed elsewhere but lost. Shown so no uncertainty is hidden. */
  alsoObserved: string[];
  /** Every check that ran, including the ones that found nothing. */
  checked: string[];
}

export interface ClassificationResult {
  schemaVersion: typeof CLASSIFICATION_SCHEMA_VERSION;
  report: {
    schemaVersion: number;
    generator: FlakeReport['generator'];
    workers: number;
    shard: FlakeReport['run']['shard'];
    git: FlakeReport['git'];
    ci: FlakeReport['ci'];
  };
  summary: { classified: number } & Record<Verdict, number>;
  classifications: Classification[];
}

/** 1 = weak (low), 2 = medium, 3 = strong (high). */
export type Strength = 1 | 2 | 3;

export interface Signal {
  verdict: Verdict;
  strength: Strength;
  evidence: string[];
}

/** What a rule returns: zero or more signals, plus a description of what it checked. */
export interface RuleResult {
  signals: Signal[];
  checked: string;
}
