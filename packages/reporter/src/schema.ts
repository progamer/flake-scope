/**
 * `flake-report.json` — public contract. See docs/report-schema.md.
 *
 * Compatibility rule: additive, optional fields may be added without bumping
 * `schemaVersion`. Removing, renaming, or changing the meaning of a field bumps it.
 */
export const SCHEMA_VERSION = 1 as const;

export type AttemptStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
export type TestOutcome = 'skipped' | 'expected' | 'unexpected' | 'flaky';

export interface FlakeReport {
  schemaVersion: typeof SCHEMA_VERSION;
  generator: { name: string; version: string };
  run: RunInfo;
  git: GitInfo;
  ci: CiInfo | null;
  host: HostInfo;
  summary: Summary;
  /** Tests with more than one attempt, or whose final outcome is `unexpected`. */
  tests: ReportedTest[];
}

export interface RunInfo {
  /** ISO 8601. */
  startTime: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'timedout' | 'interrupted';
  playwrightVersion: string;
  /** Effective worker count for this run. `workers > 1` is a key parallelism signal. */
  workers: number;
  fullyParallel: boolean;
  /** 1-based shard of this report, or null when the run was not sharded. */
  shard: { current: number; total: number } | null;
  projects: ProjectInfo[];
  /** Errors outside any test (global setup, worker teardown, …). Redacted. */
  errors: ReportedError[];
}

export interface ProjectInfo {
  name: string;
  retries: number;
  repeatEach: number;
  /**
   * Where the project's storageState comes from. Contents are NEVER recorded:
   * a file path (relative to the report's base dir), `"<inline>"` for an object, or null.
   */
  storageState: string | null;
}

export interface GitInfo {
  /** Commit the run tested. On GitHub `pull_request` events this is the merge commit. */
  sha: string | null;
  /** PR head commit, when known. */
  headSha: string | null;
  branch: string | null;
  pullRequest: number | null;
}

export interface CiInfo {
  provider: 'github-actions' | 'unknown';
  runnerOs: string | null;
  runnerArch: string | null;
  repository: string | null;
  serverUrl: string | null;
  workflow: string | null;
  jobId: string | null;
  runId: string | null;
  runAttempt: string | null;
}

export interface HostInfo {
  platform: string;
  arch: string;
  cpus: number;
  nodeVersion: string;
}

export interface Summary {
  total: number;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  /** Number of entries in `tests`. */
  reported: number;
}

export interface ReportedTest {
  /** Playwright's stable test id. */
  id: string;
  title: string;
  /** Describe blocks + title, without the project/file prefix. */
  titlePath: string[];
  /** Posix path relative to the report's base dir. */
  file: string;
  line: number;
  column: number;
  project: string;
  tags: string[];
  outcome: TestOutcome;
  expectedStatus: AttemptStatus;
  /** Retries allowed for this test by config. */
  retries: number;
  /**
   * Shared things this test touches: `flakescope:resource` annotations
   * (e.g. `account:alice`) plus the project's `storageState:<path>`.
   */
  resources: string[];
  annotations: { type: string; description: string | null }[];
  attempts: Attempt[];
}

export interface Attempt {
  retry: number;
  status: AttemptStatus;
  workerIndex: number;
  parallelIndex: number;
  startTime: string;
  durationMs: number;
  errors: ReportedError[];
  attachments: ReportedAttachment[];
  /** Attempts of other tests that ran on a different worker while this one was running. */
  concurrent: ConcurrentAttempt[];
  /** True when `concurrent` was capped. */
  concurrentTruncated: boolean;
}

export interface ReportedError {
  /** Redacted, ANSI stripped. */
  message: string;
  /** Redacted, ANSI stripped. */
  stack: string | null;
  location: { file: string; line: number; column: number } | null;
}

export interface ReportedAttachment {
  name: string;
  contentType: string;
  /** Posix path relative to the report's base dir; null for in-memory bodies (never recorded). */
  path: string | null;
}

export interface ConcurrentAttempt {
  testId: string;
  title: string;
  file: string;
  project: string;
  retry: number;
  status: AttemptStatus;
  workerIndex: number;
  parallelIndex: number;
  overlapMs: number;
  /** Resources both tests declare. Non-empty is strong evidence of shared state. */
  sharedResources: string[];
}
