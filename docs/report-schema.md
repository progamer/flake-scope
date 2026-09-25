# `flake-report.json` (schemaVersion 1)

Written by `@flakescope/reporter` at the end of every Playwright run. It is a public contract.
The TypeScript source of truth is [`packages/reporter/src/schema.ts`](../packages/reporter/src/schema.ts).

## Versioning

- Adding a new optional field does **not** change `schemaVersion`.
- Removing, renaming, or changing the meaning of a field bumps `schemaVersion`.
- Consumers should ignore fields they don't know.

## Where it is written

`<first project's outputDir>/flake-report.json` (usually `test-results/flake-report.json`).
You can override it with the `outputFile` reporter option or the `FLAKESCOPE_OUTPUT_FILE` env var.
A sharded run writes one report per shard. `run.shard` says which shard each report came from.

## Paths

Every path (test files, attachments, `storageState`) is **posix and relative to the directory of
the Playwright config file**. Absolute paths inside error messages and stacks are replaced with `<root>`,
so usernames and home directories don't leak.

## What is included

- `summary` counts every test in the run.
- `tests` lists only tests with **more than one attempt** or a final outcome of **`unexpected`**.
- For each attempt, `concurrent` lists attempts of _other_ tests that ran on a _different worker_
  at the same time. Entries that share resources come first, and the list is capped at 50
  (`concurrentTruncated`).

## Resources (shared-state evidence)

A test's `resources` combine:

1. `flakescope:resource` annotations, e.g.
   `test.info().annotations.push({ type: 'flakescope:resource', description: 'account:alice' })`
2. `storageState:<path>` when the test's project uses a file-based `storageState`.

`concurrent[].sharedResources` is the overlap between two tests' resources. The classifier uses
it as the strongest signal for `shared-state-race`.

## Redaction (never written to the report)

- `storageState` contents: only the path is recorded, or `<inline>` for an object.
- Attachment bodies: only the name, content type, and path are recorded.
- stdout/stderr: not recorded.
- Error messages, stacks, and annotation descriptions are redacted for:
  - credential headers: `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, …
  - bearer/basic tokens and JWTs
  - GitHub, AWS, Slack, Stripe, and OpenAI-style keys
  - `user:pass@` inside URLs
  - secret query params: `token`, `code`, `sig`, …
  - `password=` / `"secret": "…"` assignments
  - the value of any env var whose name looks secret (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`,
    `*API_KEY*`, …) and is at least 8 characters long
- Reporter options for more redaction: `redactEnv: ['TEST_USER_EMAIL']`, `redactPatterns: [/acct-\d+/]`.
