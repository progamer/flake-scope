# FlakeScope

Playwright tells you a test is flaky. FlakeScope tells you why, in the pull request, with the evidence.

FlakeScope has three parts:

- **[`@flakescope/reporter`](packages/reporter)**: a Playwright reporter that writes `flake-report.json` at the
  end of every run. For each flaky or failing test it records every attempt: status, worker, timing, redacted
  errors, attachment paths, the tests that ran at the same time on other workers, and the shared resources each
  test declared.
- **[`@flakescope/classify`](packages/classify)**: a deterministic classifier that reads the report and gives each
  flaky or failing test one verdict, a confidence level, and the evidence behind it. The same report always
  produces the same result. It uses no AI and makes no network calls.
- **The GitHub Action** (`progamer/flake-scope@v0`): finds the reports, classifies them, and posts one pull
  request comment that it updates on later runs. It writes the same Markdown to the job summary.

See [`docs/pr-comment-example.md`](docs/pr-comment-example.md) for an example of the comment.

## Verdicts

| Verdict              | Meaning                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `likely-regression`  | Failed on every attempt, usually with the same error. Probably a real bug.                   |
| `shared-state-race`  | A failing attempt overlapped another test that uses the same declared resource.              |
| `env-resource`       | Timeouts, connection errors, browser/worker crashes, out-of-memory, or a slow first attempt. |
| `known-intermittent` | Passed on retry, and nothing in the report explains why.                                     |

Each verdict comes with a confidence (`low`, `medium`, `high`), the evidence that produced it, the signals that
pointed elsewhere, and the list of checks that ran. A verdict is a hypothesis backed by evidence, not a root cause.
The rules are documented in [docs/classification.md](docs/classification.md).

## Quick start

Requirements: Node.js 20 or later, `@playwright/test` 1.40 or later.

**1. Install the reporter.**

```sh
npm install --save-dev @flakescope/reporter
# or: pnpm add -D @flakescope/reporter
# or: yarn add -D @flakescope/reporter
```

**2. Add it to your Playwright config**, next to the reporters you already use:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html'], ['@flakescope/reporter']],
  // ...
});
```

FlakeScope does not change how tests run. A test is only "flaky" when it fails and then passes on a retry, so
`retries` should be at least 1 in CI. Race detection compares attempts running on different workers, so it needs
`workers` greater than 1.

**3. Add the Action to your workflow**, after the test step:

```yaml
name: E2E

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test

      - name: Explain flaky tests
        if: always()
        uses: progamer/flake-scope@v0
```

`if: always()` matters: without it, the Action is skipped whenever a test fails, which is exactly when you need it.

For sharded runs, customized output directories, and troubleshooting, see [docs/install.md](docs/install.md).

## The GitHub Action

### Inputs

| Input                | Default                | Description                                                                                                                                                                        |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-path`        | `**/flake-report.json` | Newline-separated glob(s) for report files. `node_modules` is skipped. Several matches (for example, from sharded runs) are merged into one comment.                               |
| `github-token`       | `${{ github.token }}`  | Token used to create and update the pull request comment.                                                                                                                          |
| `comment`            | `auto`                 | `auto`: create a comment only when there are findings, and always update an existing FlakeScope comment. `always`: always create or update the comment. `never`: job summary only. |
| `fail-on-regression` | `false`                | When `true`, fail the step if any test is classified `likely-regression` with `medium` or `high` confidence.                                                                       |

### Outputs

| Output        | Description                                         |
| ------------- | --------------------------------------------------- |
| `flaky`       | Number of flaky tests (failed, then passed).        |
| `failed`      | Number of tests that failed on every attempt.       |
| `classified`  | Number of tests that received a verdict.            |
| `regressions` | Number of `likely-regression` verdicts.             |
| `comment-url` | URL of the pull request comment, when one was made. |
| `result-path` | Path to the merged classification JSON.             |

### Behavior

- The Action keeps one comment per pull request. It finds its own comment through a hidden marker and updates it
  on later runs instead of adding new ones.
- It always writes the same Markdown to the job summary.
- It needs `pull-requests: write` to comment, plus `contents: read` for checkout.
- On pull requests from forks, the token cannot comment. The Action logs a warning and still writes the job
  summary.
- It never fails your job because commenting failed. The only way it fails the step on purpose is
  `fail-on-regression: true`.
- Its only network calls go to the GitHub API, to read and write the comment.

## Declaring shared resources

Two tests that use the same account, tenant, or database row can break each other when they run at the same
time on different workers. The reporter records which tests overlapped in time, but it cannot see what they
touched. You tell it with the `flakescope:resource` annotation:

```ts
import { test } from '@playwright/test';

test('renames the profile', async ({ page }) => {
  test.info().annotations.push({ type: 'flakescope:resource', description: 'account:alice' });
  // ...
});

// Or, in Playwright 1.42 and later, in the test details:
test('changes the avatar', { annotation: { type: 'flakescope:resource', description: 'account:alice' } }, async () => {
  // ...
});
```

The description is any string you choose. Add one annotation per resource. When a failing attempt overlapped
another test that declares the same resource, the `shared-state-race` verdict gets **high** confidence.

Projects that use a file-based `storageState` also get an implicit `storageState:<path>` resource. Because many
suites share one login across every test, that alone gives at most **medium** confidence. A declared resource is
specific, so it is stronger evidence. Without either, a race can only be suggested at **low** confidence.

## Privacy and redaction

The reporter makes no network calls. It reads git metadata locally and CI metadata from environment variables.

These are never written to the report:

- `storageState` contents (only the file path, or `<inline>`)
- attachment bodies such as screenshots and traces (only the name, content type, and path)
- test stdout and stderr

Error messages, stacks, and annotation descriptions are redacted before they are written. The redaction covers
credential headers, bearer and basic tokens, JWTs, common API key formats, `user:pass@` in URLs, secret query
parameters, `password=`-style assignments, and the value of any environment variable whose name looks secret
(`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, and similar). Absolute paths are replaced with `<root>` so
usernames and home directories do not appear. You can add your own variables and patterns with `redactEnv` and
`redactPatterns`.

The full list is in [docs/report-schema.md](docs/report-schema.md#redaction-never-written-to-the-report).
Redaction is pattern-based, so review the report before sharing it outside your organization if your tests
handle unusual secret formats.

## Reporter options

```ts
reporter: [['@flakescope/reporter', { outputFile: 'reports/flake-report.json', redactEnv: ['TEST_USER_EMAIL'] }]],
```

| Option           | Type                   | Default                                         | Description                                                                                            |
| ---------------- | ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `outputFile`     | `string`               | `<first project's outputDir>/flake-report.json` | Where to write the report. Relative paths resolve against the directory of the Playwright config file. |
| `redactEnv`      | `string[]`             | `[]`                                            | Extra environment variable names whose values must never appear, regardless of their name or length.   |
| `redactPatterns` | `(string \| RegExp)[]` | `[]`                                            | Extra patterns to redact from error messages, stacks, and annotations. Strings are matched literally.  |
| `quiet`          | `boolean`              | `false`                                         | Suppress the one-line summary (`FlakeScope: 1 flaky, 0 failed → test-results/flake-report.json`).      |

The `FLAKESCOPE_OUTPUT_FILE` environment variable sets the output file when `outputFile` is not set.

The default location is usually `test-results/flake-report.json`. If writing the report fails, the reporter
prints an error and leaves your test run's result unchanged.

## Sharding

Each shard writes its own `flake-report.json`, and `run.shard` records which shard it came from. Give the Action
all of them (see [the sharded setup in docs/install.md](docs/install.md#sharded-runs)) and it merges them into one
comment. Concurrency is only compared within a shard, because tests in different shards run on different machines.

## Limitations

- **Single-run analysis.** Each verdict is based on the current run only. Patterns that need history, such as
  "fails only when workers > 1" or failure rates over time, are not detected.
- **Only declared resources are visible.** The classifier sees `flakescope:resource` annotations and the project's
  `storageState` path. It does not see the fixtures, databases, or URLs a test touches.
- **GitHub Actions only for the pull request comment.** The reporter and classifier run anywhere Node.js runs, but
  the comment and job summary are produced by the GitHub Action.

## Documentation

- [Installation guide](docs/install.md), including sharded runs and troubleshooting
- [Classification rules](docs/classification.md)
- [`flake-report.json` schema](docs/report-schema.md)
- [Example pull request comment](docs/pr-comment-example.md)
- [Changelog](CHANGELOG.md)

## Development

This repository is a pnpm workspace. You need Node.js 20 or later and pnpm (the version is pinned in
`package.json`; `corepack enable` picks it up).

```sh
pnpm install
pnpm test   # build the packages, then run the unit tests
pnpm lint   # ESLint and Prettier
pnpm demo   # build, then run the demo suite with 4 workers and 2 retries
```

Before the first `pnpm demo`, install the browser: `pnpm --filter demo exec playwright install chromium`.

The demo in [`examples/demo`](examples/demo) runs a small local app with deliberately flaky tests, one per
verdict:

| Test                                                    | Scenario                                                                                   | Expected verdict     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------- |
| `profile-a.spec.ts`, `profile-b.spec.ts`                | Both rename the same account (`account:alice`) at the same time on different workers.      | `shared-state-race`  |
| `dashboard.spec.ts`                                     | The first request hits a cold cache and exceeds the test timeout; the retry finds it warm. | `env-resource`       |
| `search.spec.ts`                                        | The first search response comes back unsorted, with no correlating signal.                 | `known-intermittent` |
| `checkout.spec.ts` (with `DEMO_REGRESSION=1 pnpm demo`) | The server returns a wrong cart total on every attempt.                                    | `likely-regression`  |

The profile race depends on timing, so an individual run may not reproduce it. The flaky tests pass on
retry, so `pnpm demo` normally succeeds; with `DEMO_REGRESSION=1` it fails. The report is written to
`examples/demo/test-results/flake-report.json`.

## License

[MIT](LICENSE)
