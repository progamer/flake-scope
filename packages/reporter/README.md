# @codept/flakescope-reporter

A Playwright reporter that records the evidence needed to explain why a test is flaky.

At the end of every run it writes `flake-report.json`. For each flaky or failing test it records every attempt:
status, worker, timing, redacted errors, attachment paths, the tests that ran at the same time on other workers,
and the shared resources each test declared. The report is read by
[`@codept/flakescope-classify`](https://www.npmjs.com/package/@codept/flakescope-classify) and the
[FlakeScope GitHub Action](https://github.com/progamer/flake-scope#readme), which explain each flaky test in the
pull request.

The reporter makes no network calls and never fails your test run.

## Install

```sh
npm install --save-dev @codept/flakescope-reporter
```

Requires Node.js 20 or later and `@playwright/test` 1.40 or later.

## Usage

Add it to the `reporter` array in `playwright.config.ts`, next to the reporters you already use:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['@codept/flakescope-reporter']],
});
```

The report is written to `<first project's outputDir>/flake-report.json`, usually
`test-results/flake-report.json`, and the reporter prints one summary line:

```text
FlakeScope: 1 flaky, 0 failed → test-results/flake-report.json
```

A test only counts as flaky when it fails and then passes on a retry, so set `retries` to at least 1 in CI.

## Options

```ts
reporter: [
  ['list'],
  ['@codept/flakescope-reporter', { outputFile: 'reports/flake-report.json', redactEnv: ['TEST_USER_EMAIL'] }],
],
```

| Option           | Type                   | Default                                         | Description                                                                                            |
| ---------------- | ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `outputFile`     | `string`               | `<first project's outputDir>/flake-report.json` | Where to write the report. Relative paths resolve against the directory of the Playwright config file. |
| `redactEnv`      | `string[]`             | `[]`                                            | Extra environment variable names whose values must never appear, regardless of their name or length.   |
| `redactPatterns` | `(string \| RegExp)[]` | `[]`                                            | Extra patterns to redact from error messages, stacks, and annotations. Strings are matched literally.  |
| `quiet`          | `boolean`              | `false`                                         | Suppress the one-line summary at the end of the run.                                                   |

The `FLAKESCOPE_OUTPUT_FILE` environment variable sets the output file when `outputFile` is not set.

## Declaring shared resources

Tell the reporter what state a test shares with other tests, such as an account or a tenant:

```ts
test('renames the profile', async ({ page }) => {
  test.info().annotations.push({ type: 'flakescope:resource', description: 'account:alice' });
  // ...
});
```

When a failing attempt overlapped another test that declares the same resource, the classifier reports a
`shared-state-race` with high confidence. Projects with a file-based `storageState` also get an implicit
`storageState:<path>` resource, which is weaker evidence because many tests share one login.

## What is recorded

- Only tests with more than one attempt, or whose final outcome is `unexpected`, are listed. `summary` counts every
  test.
- For each attempt: status, worker and parallel index, start time, duration, errors, attachment names and paths,
  and the attempts of other tests that overlapped it on other workers (capped at 50).
- Run metadata: Playwright version, worker count, shard, projects, and retries.
- Git commit, branch, and pull request number, read locally from git and from GitHub Actions environment variables.

## What is never recorded

- `storageState` contents (only the path, or `<inline>`)
- attachment bodies such as screenshots and traces
- test stdout and stderr

Error messages, stacks, and annotation descriptions are redacted for credential headers, tokens, JWTs, common API
key formats, credentials in URLs, secret query parameters, password assignments, and the values of secret-looking
environment variables. Absolute paths are replaced with `<root>`.

## Exports

```ts
import FlakeScopeReporter, {
  type FlakeScopeOptions,
  type FlakeReport,
  SCHEMA_VERSION,
  RESOURCE_ANNOTATION, // 'flakescope:resource'
  DEFAULT_REPORT_NAME, // 'flake-report.json'
  createRedactor,
  stripAnsi,
} from '@codept/flakescope-reporter';
```

All report types (`FlakeReport`, `ReportedTest`, `Attempt`, and the rest) are exported for tools that read the
report.

## Documentation

- [FlakeScope README](https://github.com/progamer/flake-scope#readme)
- [Installation guide](https://github.com/progamer/flake-scope/blob/main/docs/install.md)
- [`flake-report.json` schema (schemaVersion 1)](https://github.com/progamer/flake-scope/blob/main/docs/report-schema.md)

## License

MIT
