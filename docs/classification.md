# Classification

`@codept/flakescope-classify` reads a `flake-report.json` and gives each flaky or failing test one verdict.
It is deterministic: the same report always produces the same result. There are no heuristics you can't read in
[`rules.ts`](../packages/classify/src/rules.ts), and no network calls or AI.

```ts
import { classify } from '@codept/flakescope-classify';
const result = classify(report); // ClassificationResult
```

## Verdicts

| Verdict              | Meaning                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `likely-regression`  | Failed on every attempt, usually with the same error. Probably a real bug.                   |
| `shared-state-race`  | A failing attempt overlapped another test that uses the same resource.                       |
| `env-resource`       | Timeouts, connection errors, browser/worker crashes, out-of-memory, or a slow first attempt. |
| `known-intermittent` | Passed on retry and nothing in the report explains why.                                      |

Every classification includes:

- `confidence`: `low`, `medium`, or `high`.
- `evidence`: the facts behind the verdict. Each one names the attempt, worker, resource, or file:line it came from.
- `alsoObserved`: signals that pointed at a different verdict but lost.
- `checked`: every check that ran, including the ones that found nothing.

A verdict is a hypothesis backed by evidence, never a root cause.

## Rules

Each rule emits signals with a strength: 1 = low, 2 = medium, 3 = high.

### likely-regression

This rule applies only when the test's outcome is `unexpected` and every attempt failed.

| Situation                                                             | Strength    |
| --------------------------------------------------------------------- | ----------- |
| Same error fingerprint on 3 or more attempts                          | 3           |
| Same fingerprint on 2 attempts                                        | 2           |
| Only one attempt (`retries: 0`)                                       | 1           |
| Attempts failed with different errors                                 | 1           |
| The shared error is a timeout                                         | capped at 2 |
| The shared error is a connection error, crash, or resource exhaustion | 1           |

An error **fingerprint** is the first line of the message plus its file:line:column. UUIDs, long hex strings,
durations, ports, and numbers are normalized so that run-specific values don't split one error into many.

### shared-state-race

This rule looks at the `concurrent` attempts recorded for each failed attempt.

| Situation                                                                        | Strength |
| -------------------------------------------------------------------------------- | -------- |
| Overlapped a test sharing a declared `flakescope:resource`                       | 3        |
| The only shared resource is the project `storageState`                           | 2        |
| A passing attempt also overlapped a resource-sharing test                        | minus 1  |
| No shared resource, but the failures ran alongside others and the pass ran alone | 1        |

`storageState` alone is capped at medium because many suites share one login across every test.
To get high-confidence race detection, declare what your tests share:

```ts
test.info().annotations.push({ type: 'flakescope:resource', description: 'account:alice' });
```

### env-resource

| Situation                                                                                   | Strength |
| ------------------------------------------------------------------------------------------- | -------- |
| A failed attempt hit a connection error, browser/worker crash, or resource exhaustion       | 3        |
| A failed attempt timed out                                                                  | 2        |
| Timed-out first attempt that was at least 3x slower (and 1 s slower) than the passing retry | 3        |
| Slow first attempt that failed an assertion                                                 | 1        |

A failed assertion waits for its `expect` timeout, so it is naturally slower than a pass. For that reason,
a slow first attempt counts only when it timed out.

The **"Timeout: 2000ms" line in an `expect()` failure is not a timeout**. It means the assertion
waited and saw the wrong value.

## Picking the verdict

1. Run every rule.
2. Only signals of strength 2 or more can decide. When two signals have the same strength, the order is
   `likely-regression` → `shared-state-race` → `env-resource`.
3. If nothing is decisive:
   - a test that never passed becomes `likely-regression` (low);
   - a test that passed on retry becomes `known-intermittent` (low).
4. Every other signal is listed in `alsoObserved`.

## Known limits

- Each classification is based on one report. "Fails only with workers > 1" needs history across runs,
  so it is not detected.
- Sharded runs produce one report per shard. Concurrency is only compared within a shard.
- Only declared resources and `storageState` are visible. Fixtures, databases, and URLs a test touches are not.

## Result format (schemaVersion 1)

The TypeScript source of truth is [`packages/classify/src/types.ts`](../packages/classify/src/types.ts).
It follows the same versioning rule as the report: optional additions don't bump the version.
