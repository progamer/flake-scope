# @codept/flakescope-classify

Deterministic classification of Playwright flaky and failing tests from a `flake-report.json`.

It reads a report written by [`@codept/flakescope-reporter`](https://www.npmjs.com/package/@codept/flakescope-reporter) and
gives each flaky or failing test one verdict, a confidence level, and the evidence behind it. The same report
always produces the same result. It uses no AI and makes no network calls.

The [FlakeScope GitHub Action](https://github.com/progamer/flake-scope#readme) uses this package to write its pull
request comment. Use the package directly to classify reports in your own scripts or in other CI systems.

## Install

```sh
npm install @codept/flakescope-classify
```

Requires Node.js 20 or later. The package is ESM only.

## Usage

```ts
import { readFile } from 'node:fs/promises';
import { classify } from '@codept/flakescope-classify';
import type { FlakeReport } from '@codept/flakescope-reporter';

const report = JSON.parse(await readFile('test-results/flake-report.json', 'utf8')) as FlakeReport;
const result = classify(report);

for (const c of result.classifications) {
  console.log(`${c.file}:${c.line} ${c.title}: ${c.verdict} (${c.confidence})`);
  for (const line of c.evidence) console.log(`  - ${line}`);
}
```

`classify` throws if the report's `schemaVersion` is not one it supports (currently 1).

## Verdicts

| Verdict              | Meaning                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `likely-regression`  | Failed on every attempt, usually with the same error. Probably a real bug.                   |
| `shared-state-race`  | A failing attempt overlapped another test that uses the same resource.                       |
| `env-resource`       | Timeouts, connection errors, browser/worker crashes, out-of-memory, or a slow first attempt. |
| `known-intermittent` | Passed on retry, and nothing in the report explains why.                                     |

Each classification includes:

- `confidence`: `low`, `medium`, or `high`
- `evidence`: the facts behind the verdict, each naming the attempt, worker, resource, or file:line it came from
- `alsoObserved`: signals that pointed at a different verdict but lost
- `checked`: every check that ran, including the ones that found nothing

A verdict is a hypothesis backed by evidence, not a root cause. The rules are documented in
[classification.md](https://github.com/progamer/flake-scope/blob/main/docs/classification.md).

## API

| Export                                                                                           | Description                                                                                    |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `classify(report: FlakeReport): ClassificationResult`                                            | Classify every flaky or failing test in a report.                                              |
| `classifyTest(test: ReportedTest): Classification \| null`                                       | Classify one test. Returns `null` for tests whose outcome is not `flaky` or `unexpected`.      |
| `regressionRule`, `raceRule`, `envRule`                                                          | The individual rules. Each takes a `ReportedTest` and returns its signals and what it checked. |
| `errorKind`, `attemptKind`                                                                       | Categorize an error or attempt as `timeout`, `connection`, `crash`, `resource`, or `other`.    |
| `fingerprint`, `messageKey`, `normalize`                                                         | Error fingerprinting helpers used to decide whether two attempts failed the same way.          |
| `SUPPORTED_REPORT_SCHEMA_VERSION`, `CLASSIFICATION_SCHEMA_VERSION`                               | The report version this package reads (1) and the version of its result format (1).            |
| `SLOW_RATIO`, `SLOW_MIN_DIFF_MS`                                                                 | Thresholds for a "slow first attempt" (3x and 1000 ms).                                        |
| Types: `ClassificationResult`, `Classification`, `Verdict`, `Confidence`, `Signal`, `RuleResult` | Result types.                                                                                  |

`ClassificationResult` contains `schemaVersion`, a copy of the report's metadata (`report`), a `summary` with a
count per verdict, and the list of `classifications`.

## Limitations

- Each result is based on a single report. Patterns that need history across runs are not detected.
- Concurrency is only compared within one report, so within one shard.
- Only `flakescope:resource` annotations and the project's `storageState` path are visible as shared state.

## Documentation

- [FlakeScope README](https://github.com/progamer/flake-scope#readme)
- [Classification rules](https://github.com/progamer/flake-scope/blob/main/docs/classification.md)
- [`flake-report.json` schema](https://github.com/progamer/flake-scope/blob/main/docs/report-schema.md)

## License

MIT
