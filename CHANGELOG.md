# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-25

First public release.

### Added

- `@codept/flakescope-reporter`: a Playwright reporter that writes `flake-report.json` at the end of every run.
  - Records every attempt of each flaky or failing test: status, worker, timing, errors, and attachment paths.
  - Records the attempts of other tests that overlapped each attempt on other workers, and the resources they
    share.
  - Shared resources come from `flakescope:resource` annotations and from the project's file-based
    `storageState`.
  - Records run, git, CI, and host metadata, including the shard.
  - Redacts credentials, tokens, secret-looking environment variables, and absolute paths from error messages,
    stacks, and annotations. Never records `storageState` contents, attachment bodies, or stdout/stderr.
  - Options: `outputFile`, `redactEnv`, `redactPatterns`, `quiet`; environment variable `FLAKESCOPE_OUTPUT_FILE`.
- `@codept/flakescope-classify`: deterministic classification of flaky and failing tests into `likely-regression`,
  `shared-state-race`, `env-resource`, or `known-intermittent`, with a confidence level, evidence, other observed
  signals, and the list of checks that ran.
- GitHub Action (`progamer/flake-scope@v0`): finds and merges reports, classifies them, writes one pull request
  comment that is updated on later runs, and writes the same Markdown to the job summary. Inputs: `report-path`,
  `github-token`, `comment`, `fail-on-regression`.
- `flake-report.json` format, schemaVersion 1 ([docs/report-schema.md](docs/report-schema.md)).
- Classification result format, schemaVersion 1 ([docs/classification.md](docs/classification.md)).
- Demo project in `examples/demo` with deliberately flaky tests for each verdict.

[0.1.0]: https://github.com/progamer/flake-scope/releases/tag/v0.1.0
