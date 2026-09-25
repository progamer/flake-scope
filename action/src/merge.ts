import { classify, SUPPORTED_REPORT_SCHEMA_VERSION, type Classification, type Verdict } from '@flakescope/classify';
import type { FlakeReport } from '@flakescope/reporter';

/** Format of the merged result written to `result-path`. Additive changes keep the version. */
export const RESULT_SCHEMA_VERSION = 1 as const;

export const VERDICTS: Verdict[] = ['likely-regression', 'shared-state-race', 'env-resource', 'known-intermittent'];

export interface ReportSource {
  /** Path of the flake-report.json this entry came from. */
  path: string;
  generator: FlakeReport['generator'];
  playwrightVersion: string;
  workers: number;
  shard: FlakeReport['run']['shard'];
  status: FlakeReport['run']['status'];
  /** Errors outside any test (global setup, worker teardown, ...). */
  runErrors: number;
  git: FlakeReport['git'];
  ci: FlakeReport['ci'];
  summary: FlakeReport['summary'];
}

export interface MergedClassification extends Classification {
  /** Index into `reports`. */
  report: number;
  /** Trace and screenshot paths from the failing attempts, relative to the report's base dir. */
  attachments: string[];
}

export interface MergedResult {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  reports: ReportSource[];
  summary: {
    total: number;
    expected: number;
    flaky: number;
    unexpected: number;
    skipped: number;
    classified: number;
  } & Record<Verdict, number>;
  classifications: MergedClassification[];
}

export interface LoadedReport {
  path: string;
  report: FlakeReport;
}

/** Parses one report file. Returns an error message instead of throwing so one bad shard does not stop the rest. */
export function parseReport(text: string, file: string): { report: FlakeReport } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: `${file} is not valid JSON (${(e as Error).message}). Skipping it.` };
  }
  if (typeof data !== 'object' || data === null || !('schemaVersion' in data)) {
    return { error: `${file} does not look like a flake-report.json (no schemaVersion). Skipping it.` };
  }
  const version = (data as { schemaVersion: unknown }).schemaVersion;
  if (version !== SUPPORTED_REPORT_SCHEMA_VERSION) {
    return {
      error:
        `${file} has schemaVersion ${String(version)}, but this action reads version ` +
        `${SUPPORTED_REPORT_SCHEMA_VERSION}. Use matching versions of @flakescope/reporter and the action. Skipping it.`,
    };
  }
  const report = data as FlakeReport;
  if (!Array.isArray(report.tests) || typeof report.summary !== 'object' || typeof report.run !== 'object') {
    return { error: `${file} is missing required fields (run, summary, tests). Skipping it.` };
  }
  return { report };
}

const isFailedStatus = (status: string): boolean => status !== 'passed' && status !== 'skipped';

function evidenceAttachments(report: FlakeReport, testId: string): string[] {
  const test = report.tests.find((t) => t.id === testId);
  if (!test) return [];
  const paths: string[] = [];
  for (const attempt of test.attempts) {
    if (!isFailedStatus(attempt.status)) continue;
    for (const a of attempt.attachments) {
      if (!a.path) continue;
      if (a.name === 'trace' || a.name === 'screenshot' || a.contentType.startsWith('image/')) paths.push(a.path);
    }
  }
  return [...new Set(paths)];
}

/** Classifies each report and merges them (one per shard) into a single result. */
export function mergeReports(loaded: LoadedReport[]): MergedResult {
  const summary: MergedResult['summary'] = {
    total: 0,
    expected: 0,
    flaky: 0,
    unexpected: 0,
    skipped: 0,
    classified: 0,
    'likely-regression': 0,
    'shared-state-race': 0,
    'env-resource': 0,
    'known-intermittent': 0,
  };
  const reports: ReportSource[] = [];
  const classifications: MergedClassification[] = [];

  loaded.forEach(({ path, report }, index) => {
    const result = classify(report);
    reports.push({
      path,
      generator: report.generator,
      playwrightVersion: report.run.playwrightVersion,
      workers: report.run.workers,
      shard: report.run.shard,
      status: report.run.status,
      runErrors: report.run.errors?.length ?? 0,
      git: report.git,
      ci: report.ci,
      summary: report.summary,
    });
    summary.total += report.summary.total;
    summary.expected += report.summary.expected;
    summary.flaky += report.summary.flaky;
    summary.unexpected += report.summary.unexpected;
    summary.skipped += report.summary.skipped;
    summary.classified += result.summary.classified;
    for (const verdict of VERDICTS) summary[verdict] += result.summary[verdict];
    for (const c of result.classifications) {
      classifications.push({ ...c, report: index, attachments: evidenceAttachments(report, c.testId) });
    }
  });

  return { schemaVersion: RESULT_SCHEMA_VERSION, reports, summary, classifications };
}
