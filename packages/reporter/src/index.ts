import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullProject,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from '@playwright/test/reporter';
import { findConcurrent, type AttemptRecord } from './concurrency.js';
import { collectCi, collectGit, collectHost } from './env.js';
import { createRedactor, stripAnsi, type Redactor } from './redact.js';
import {
  SCHEMA_VERSION,
  type Attempt,
  type FlakeReport,
  type ProjectInfo,
  type ReportedError,
  type ReportedTest,
  type TestOutcome,
} from './schema.js';

export * from './schema.js';
export { createRedactor, stripAnsi } from './redact.js';

export const RESOURCE_ANNOTATION = 'flakescope:resource';
export const DEFAULT_REPORT_NAME = 'flake-report.json';

export interface FlakeScopeOptions {
  /** Where to write the report. Default: `<first project's outputDir>/flake-report.json`. Env: FLAKESCOPE_OUTPUT_FILE. */
  outputFile?: string;
  /** Extra env var names whose values must never appear in the report. */
  redactEnv?: string[];
  /** Extra patterns to redact from error messages, stacks, and annotations. */
  redactPatterns?: (string | RegExp)[];
  /** Suppress the one-line summary printed at the end of the run. */
  quiet?: boolean;
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

interface RunContext {
  config: FullConfig;
  suite: Suite;
  baseDir: string;
  redact: Redactor;
}

export default class FlakeScopeReporter implements Reporter {
  private readonly options: FlakeScopeOptions;
  private ctx: RunContext | undefined;
  private readonly attempts: AttemptRecord[] = [];
  private readonly runErrors: TestError[] = [];

  constructor(options: FlakeScopeOptions = {}) {
    this.options = options;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    const baseDir = config.configFile ? path.dirname(config.configFile) : config.rootDir;
    this.ctx = {
      config,
      suite,
      baseDir,
      redact: createRedactor({
        env: process.env,
        redactEnv: this.options.redactEnv,
        patterns: this.options.redactPatterns,
        pathRoots: [baseDir, process.cwd(), process.env.HOME ?? '', process.env.USERPROFILE ?? ''],
      }),
    };
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const startMs = result.startTime.getTime();
    this.attempts.push({
      testId: test.id,
      title: test.title,
      file: this.rel(test.location.file),
      project: projectName(test),
      resources: resourcesOf(test, result, ctx),
      retry: result.retry,
      status: result.status,
      workerIndex: result.workerIndex,
      parallelIndex: result.parallelIndex,
      startMs,
      endMs: startMs + result.duration,
    });
  }

  onError(error: TestError): void {
    this.runErrors.push(error);
  }

  async onEnd(result: FullResult): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    // A reporter must never fail the user's test run.
    try {
      const report = this.buildReport(result, ctx);
      const file = this.outputFile(ctx);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(report, null, 2) + '\n', 'utf8');
      if (!this.options.quiet) {
        const { flaky, unexpected } = report.summary;
        process.stdout.write(
          `\nFlakeScope: ${flaky} flaky, ${unexpected} failed → ${path.relative(process.cwd(), file) || file}\n`,
        );
      }
    } catch (err) {
      process.stderr.write(`\nFlakeScope: failed to write report: ${(err as Error)?.message ?? err}\n`);
    }
  }

  // ---------------------------------------------------------------------------

  private outputFile(ctx: RunContext): string {
    const configured = this.options.outputFile ?? process.env.FLAKESCOPE_OUTPUT_FILE;
    if (configured) return path.resolve(ctx.baseDir, configured);
    const outDir = ctx.config.projects[0]?.outputDir ?? path.join(ctx.baseDir, 'test-results');
    return path.join(outDir, DEFAULT_REPORT_NAME);
  }

  /** Posix path relative to the report's base dir. */
  private rel(p: string): string {
    const ctx = this.ctx;
    if (!ctx || !path.isAbsolute(p)) return p.split(path.sep).join('/');
    return path.relative(ctx.baseDir, p).split(path.sep).join('/');
  }

  private buildReport(result: FullResult, ctx: RunContext): FlakeReport {
    const { config, suite, redact } = ctx;
    const allTests = suite.allTests();

    const counts: Record<TestOutcome, number> = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    for (const t of allTests) counts[t.outcome()]++;

    const byTest = new Map<string, AttemptRecord[]>();
    for (const a of this.attempts) {
      const list = byTest.get(a.testId) ?? [];
      list.push(a);
      byTest.set(a.testId, list);
    }

    const tests: ReportedTest[] = allTests
      .filter((t) => t.results.length > 1 || t.outcome() === 'unexpected')
      .map((t) => this.reportTest(t, byTest.get(t.id) ?? [], ctx));

    return {
      schemaVersion: SCHEMA_VERSION,
      generator: { name: pkg.name, version: pkg.version },
      run: {
        startTime: result.startTime.toISOString(),
        durationMs: Math.round(result.duration),
        status: result.status,
        playwrightVersion: config.version,
        workers: config.workers,
        fullyParallel: config.fullyParallel,
        shard: config.shard ? { current: config.shard.current, total: config.shard.total } : null,
        projects: config.projects.map((p) => this.projectInfo(p)),
        errors: this.runErrors.map((e) => this.error(e, redact)),
      },
      git: collectGit(process.env, ctx.baseDir),
      ci: collectCi(process.env),
      host: collectHost(),
      summary: { total: allTests.length, ...counts, reported: tests.length },
      tests,
    };
  }

  private projectInfo(p: FullProject): ProjectInfo {
    const state = (p.use as { storageState?: unknown }).storageState;
    return {
      name: p.name,
      retries: p.retries,
      repeatEach: p.repeatEach,
      storageState: typeof state === 'string' ? this.rel(state) : state ? '<inline>' : null,
    };
  }

  private reportTest(test: TestCase, records: AttemptRecord[], ctx: RunContext): ReportedTest {
    const { redact } = ctx;
    const attempts: Attempt[] = test.results.map((r) => {
      const record = records.find((a) => a.retry === r.retry && a.startMs === r.startTime.getTime());
      const { concurrent, truncated } = record
        ? findConcurrent(record, this.attempts)
        : { concurrent: [], truncated: false };
      return {
        retry: r.retry,
        status: r.status,
        workerIndex: r.workerIndex,
        parallelIndex: r.parallelIndex,
        startTime: r.startTime.toISOString(),
        durationMs: Math.round(r.duration),
        errors: r.errors.map((e) => this.error(e, redact)),
        attachments: r.attachments.map((a) => ({
          name: a.name,
          contentType: a.contentType,
          path: a.path ? this.rel(a.path) : null,
        })),
        concurrent,
        concurrentTruncated: truncated,
      };
    });

    const annotations = [...test.annotations, ...test.results.flatMap((r) => r.annotations ?? [])];
    const seen = new Set<string>();
    const uniqueAnnotations = annotations
      .map((a) => ({ type: a.type, description: a.description != null ? redact(a.description) : null }))
      .filter((a) => {
        const key = `${a.type}\u0000${a.description}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const resources = [...new Set(records.flatMap((r) => r.resources))];
    if (records.length === 0) resources.push(...resourcesOf(test, undefined, ctx));

    return {
      id: test.id,
      title: test.title,
      titlePath: titlePathWithinFile(test),
      file: this.rel(test.location.file),
      line: test.location.line,
      column: test.location.column,
      project: projectName(test),
      tags: test.tags,
      outcome: test.outcome(),
      expectedStatus: test.expectedStatus,
      retries: test.retries,
      resources,
      annotations: uniqueAnnotations,
      attempts,
    };
  }

  private error(e: TestError, redact: Redactor): ReportedError {
    const message = e.message ?? e.value ?? 'Unknown error';
    return {
      message: redact(stripAnsi(message)),
      stack: e.stack ? redact(stripAnsi(e.stack)) : null,
      location: e.location
        ? { file: this.rel(e.location.file), line: e.location.line, column: e.location.column }
        : null,
    };
  }
}

function projectName(test: TestCase): string {
  return test.parent.project()?.name ?? '';
}

/** titlePath() is [root '', project, file, ...describes, title]; keep describes + title. */
function titlePathWithinFile(test: TestCase): string[] {
  const parts: string[] = [];
  for (let s: Suite | undefined = test.parent; s && s.type === 'describe'; s = s.parent) {
    parts.unshift(s.title);
  }
  parts.push(test.title);
  return parts;
}

function resourcesOf(test: TestCase, result: TestResult | undefined, ctx: RunContext): string[] {
  const resources = new Set<string>();
  const annotations = [...test.annotations, ...(result?.annotations ?? [])];
  for (const a of annotations) {
    if (a.type === RESOURCE_ANNOTATION && a.description) resources.add(ctx.redact(a.description.trim()));
  }
  const state = (test.parent.project()?.use as { storageState?: unknown } | undefined)?.storageState;
  if (typeof state === 'string') {
    const rel = path.isAbsolute(state) ? path.relative(ctx.baseDir, state) : state;
    resources.add(`storageState:${rel.split(path.sep).join('/')}`);
  }
  return [...resources];
}
