import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { parseCommentMode, upsertComment, type CommentClient } from './comment.js';
import { findReports, parsePatterns } from './find.js';
import { mergeReports, parseReport, type LoadedReport, type MergedResult } from './merge.js';
import { render } from './render.js';

const DEFAULT_PATTERN = '**/flake-report.json';

function setCountOutputs(result: MergedResult | null): void {
  core.setOutput('flaky', result?.summary.flaky ?? 0);
  core.setOutput('failed', result?.summary.unexpected ?? 0);
  core.setOutput('classified', result?.summary.classified ?? 0);
  core.setOutput('regressions', result?.summary['likely-regression'] ?? 0);
}

function pullRequestNumber(): number | null {
  const { eventName, payload } = github.context;
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') return null;
  const number = payload.pull_request?.number;
  return typeof number === 'number' ? number : null;
}

function loadReports(files: string[]): LoadedReport[] {
  const loaded: LoadedReport[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      core.warning(`Could not read ${file}: ${(e as Error).message}. Skipping it.`);
      continue;
    }
    const parsed = parseReport(text, file);
    if ('error' in parsed) {
      core.warning(parsed.error);
      continue;
    }
    loaded.push({ path: file, report: parsed.report });
  }
  return loaded;
}

async function writeSummary(markdown: string): Promise<void> {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    core.info(markdown);
    return;
  }
  try {
    await core.summary.addRaw(markdown).write();
  } catch (e) {
    core.warning(`Could not write the job summary: ${(e as Error).message}`);
  }
}

export async function run(): Promise<void> {
  const patterns = parsePatterns(core.getInput('report-path') || DEFAULT_PATTERN);
  const mode = parseCommentMode(core.getInput('comment'));
  const failOnRegression = (core.getInput('fail-on-regression') || 'false').trim().toLowerCase() === 'true';
  const token = core.getInput('github-token');

  const files = findReports(patterns);
  if (files.length === 0) {
    setCountOutputs(null);
    core.warning(
      `No flake-report.json found for ${patterns.map((p) => `"${p}"`).join(', ')}. ` +
        'Add @codept/flakescope-reporter to the reporters in playwright.config and run this step after the tests ' +
        '(with "if: always()"), or set "report-path" to where the report is written. ' +
        'For sharded runs, download the report artifacts from each shard first.',
    );
    return;
  }
  core.info(`Found ${files.length} report(s): ${files.join(', ')}`);

  const loaded = loadReports(files);
  if (loaded.length === 0) {
    setCountOutputs(null);
    core.warning('None of the matched reports could be read. See the warnings above.');
    return;
  }

  const result = mergeReports(loaded);
  const { serverUrl, runId } = github.context;
  const markdown = render(result, {
    serverUrl: serverUrl || null,
    repository: process.env.GITHUB_REPOSITORY || null,
    runId: runId ? String(runId) : null,
  });

  const resultPath = path.join(process.env.RUNNER_TEMP || process.cwd(), 'flakescope-result.json');
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
  core.setOutput('result-path', resultPath);
  setCountOutputs(result);

  await writeSummary(markdown);

  const issueNumber = pullRequestNumber();
  if (mode !== 'never' && issueNumber !== null) {
    if (!token) {
      core.warning('No github-token was given, so FlakeScope cannot comment on the pull request.');
    } else {
      const client = github.getOctokit(token) as unknown as CommentClient;
      const { owner, repo } = github.context.repo;
      const comment = await upsertComment({
        client,
        owner,
        repo,
        issueNumber,
        body: markdown,
        mode,
        hasFindings: result.classifications.length > 0,
        log: core,
      });
      if (comment.url) core.setOutput('comment-url', comment.url);
    }
  } else if (mode !== 'never') {
    core.info('Not a pull_request event, so the results are only in the job summary.');
  }

  const s = result.summary;
  core.info(
    `FlakeScope: ${s.flaky} flaky, ${s.unexpected} failed, ${s.classified} classified, ` +
      `${s['likely-regression']} likely regression(s).`,
  );

  if (failOnRegression) {
    const regressions = result.classifications.filter(
      (c) => c.verdict === 'likely-regression' && (c.confidence === 'high' || c.confidence === 'medium'),
    );
    if (regressions.length > 0) {
      core.setFailed(
        `${regressions.length} likely regression(s) with medium or high confidence: ` +
          regressions.map((c) => `${c.title} (${c.file}:${c.line})`).join('; '),
      );
    }
  }
}
