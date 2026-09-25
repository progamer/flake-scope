# Installing FlakeScope

This guide sets up the FlakeScope reporter in a Playwright project and the FlakeScope GitHub Action in a
workflow. It covers a single test job, a sharded test run, and common problems.

Requirements:

- Node.js 20 or later
- `@playwright/test` 1.40 or later
- GitHub Actions, for the pull request comment and job summary

## 1. Install the reporter

```sh
npm install --save-dev @flakescope/reporter
```

With other package managers: `pnpm add -D @flakescope/reporter` or `yarn add -D @flakescope/reporter`.

## 2. Add the reporter to your Playwright config

Add `['@flakescope/reporter']` to the `reporter` array. Keep the reporters you already use; FlakeScope does not
print test results, so it works alongside `list`, `dot`, `html`, `github`, and others.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }], ['@flakescope/reporter']],
  // ...
});
```

If your config currently uses a single string, such as `reporter: 'html'`, change it to an array:
`reporter: [['html'], ['@flakescope/reporter']]`.

Check your settings:

- **Retries.** A test is only reported as flaky when it fails and then passes on a retry. With `retries: 0`,
  every failure has a single attempt, and the classifier can only give it a low-confidence verdict.
- **Workers.** Race detection compares attempts that ran at the same time on different workers. Many configs set
  `workers: process.env.CI ? 1 : undefined`; with one worker there is nothing to compare.

## 3. Run the tests locally

```sh
npx playwright test
```

At the end of the run the reporter prints one line:

```text
FlakeScope: 0 flaky, 0 failed → test-results/flake-report.json
```

The report is written after every run, including runs where every test passed. Its format is described in
[report-schema.md](report-schema.md).

## 4. Declare shared resources (recommended)

If tests share an account, tenant, or other state, declare it so the classifier can connect overlapping tests:

```ts
test('renames the profile', async ({ page }) => {
  test.info().annotations.push({ type: 'flakescope:resource', description: 'account:alice' });
  // ...
});
```

A failing attempt that overlapped another test declaring the same resource is classified `shared-state-race` with
high confidence. See [classification.md](classification.md#shared-state-race) for the rules.

## 5. Add the Action to your workflow

Add a step after your test step. It must run with `if: always()`, otherwise GitHub skips it whenever the test step
fails.

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

The Action looks for `**/flake-report.json` in the workspace (skipping `node_modules`), classifies every report it
finds, and writes the result to the job summary. When there are findings, it also posts a comment on the pull
request. On later runs it updates that same comment. See [pr-comment-example.md](pr-comment-example.md) for an
example.

### Options

```yaml
- name: Explain flaky tests
  if: always()
  uses: progamer/flake-scope@v0
  with:
    report-path: |
      e2e/test-results/flake-report.json
    comment: auto # auto | always | never
    fail-on-regression: false
```

| Input                | Default                | Description                                                                                                                                                                        |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-path`        | `**/flake-report.json` | Newline-separated glob(s) for report files. `node_modules` is skipped. Several matches are merged into one comment.                                                                |
| `github-token`       | `${{ github.token }}`  | Token used to create and update the comment.                                                                                                                                       |
| `comment`            | `auto`                 | `auto`: create a comment only when there are findings, and always update an existing FlakeScope comment. `always`: always create or update the comment. `never`: job summary only. |
| `fail-on-regression` | `false`                | When `true`, fail the step if any test is classified `likely-regression` with `medium` or `high` confidence.                                                                       |

Outputs: `flaky`, `failed`, `classified`, `regressions`, `comment-url`, and `result-path` (the merged
classification JSON). For example, to keep the classification as an artifact:

```yaml
- name: Explain flaky tests
  id: flakescope
  if: always()
  uses: progamer/flake-scope@v0

- uses: actions/upload-artifact@v7
  if: always() && steps.flakescope.outputs.result-path != ''
  with:
    name: flakescope-classification
    path: ${{ steps.flakescope.outputs.result-path }}
```

## Sharded runs

With `--shard`, each shard runs in its own job and writes its own `flake-report.json`. Upload each report as an
artifact, then run the Action once in a final job that downloads all of them. The Action merges every report it
finds into a single comment.

Concurrency is only compared within a shard, because tests in different shards run on different machines.

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
    strategy:
      fail-fast: false
      matrix:
        shardIndex: [1, 2, 3, 4]
        shardTotal: [4]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}

      - name: Upload FlakeScope report
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: flake-report-${{ matrix.shardIndex }}
          path: test-results/flake-report.json
          retention-days: 7

  flakescope:
    needs: e2e
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Download FlakeScope reports
        uses: actions/download-artifact@v8
        with:
          pattern: flake-report-*
          path: flake-reports

      - name: Explain flaky tests
        uses: progamer/flake-scope@v0
        with:
          report-path: flake-reports/**/flake-report.json
```

Notes:

- Each artifact needs a unique name, so the shard index is part of it.
- `if: always()` on the `flakescope` job makes it run even when a shard failed.
- If you changed where the report is written, update the upload `path` to match (see
  [Report path when outputDir is customized](#report-path-when-outputdir-is-customized)).

## Troubleshooting

### "No report found" / the Action finds no reports

1. **Check that the reporter ran.** Look for the `FlakeScope: … → …/flake-report.json` line at the end of the test
   step's log. If it is missing, `@flakescope/reporter` is not in the `reporter` array of the config that ran, or
   `quiet: true` is set. If the log shows `FlakeScope: failed to write report: …`, the message says why.
2. **Check that the test step reached the end.** If Playwright stops before running any test (for example,
   because of a config error), no report is written.
3. **Check that the report is in the same job.** The Action only sees files in its own workspace. When tests run
   in another job, upload the report as an artifact and download it before the Action runs, as in
   [Sharded runs](#sharded-runs).
4. **Check `report-path`.** The default glob searches the whole workspace except `node_modules`. If you set
   `outputFile` to a path outside the workspace, or you changed `report-path`, make sure they agree.

### The comment was not posted

- **Permissions.** The workflow or job needs `pull-requests: write`. If your repository or organization defaults
  the `GITHUB_TOKEN` to read-only, add the `permissions` block shown above.
- **Pull requests from forks.** GitHub gives fork pull requests a read-only token, so the Action cannot comment.
  It logs a warning and still writes the job summary. Open the workflow run to see the summary.
- **No findings.** With `comment: auto` (the default), a comment is only created when at least one test was flaky
  or failed. An existing FlakeScope comment is still updated. Use `comment: always` to always post.
- **`comment: never`.** Only the job summary is written.

A failure to comment never fails your job. Only `fail-on-regression: true` makes the Action fail the step.

### Report path when outputDir is customized

By default the report is written to `<outputDir of the first project>/flake-report.json`. If you set `outputDir`
in your config (globally or on the first project), the report moves with it:

```ts
export default defineConfig({
  outputDir: 'e2e-results',
  reporter: [['list'], ['@flakescope/reporter']], // writes e2e-results/flake-report.json
});
```

To put the report in a fixed place, set `outputFile`, or the `FLAKESCOPE_OUTPUT_FILE` environment variable. A
relative path is resolved against the directory of the Playwright config file:

```ts
reporter: [['list'], ['@flakescope/reporter', { outputFile: 'reports/flake-report.json' }]],
```

The default `report-path` glob (`**/flake-report.json`) still finds the report as long as it is inside the
workspace and keeps the name `flake-report.json`. If you rename the file, set `report-path` to match. In a sharded
setup, update the artifact upload `path` as well.

### "Unsupported flake-report schemaVersion"

The classifier reads `flake-report.json` schemaVersion 1. This error means the report was written by a reporter
version with a different schema. Use `@flakescope/reporter` and the Action from the same release line.
