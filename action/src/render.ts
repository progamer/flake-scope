import type { Confidence, Verdict } from '@flakescope/classify';
import { VERDICTS, type MergedClassification, type MergedResult, type ReportSource } from './merge.js';

export const COMMENT_MARKER = '<!-- flakescope:pr-comment -->';

/** GitHub rejects comment bodies over 65,536 characters; stay well below it. */
export const MAX_BODY_LENGTH = 60_000;

export interface RenderContext {
  /** e.g. https://github.com. Falls back to the report's CI info. */
  serverUrl?: string | null;
  /** owner/repo. Falls back to the report's CI info. */
  repository?: string | null;
  /** Workflow run id. Falls back to the report's CI info. */
  runId?: string | null;
  /** Override for tests. Defaults to MAX_BODY_LENGTH. */
  maxLength?: number;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  'likely-regression': 'Likely regression',
  'shared-state-race': 'Shared-state race',
  'env-resource': 'Env / resource',
  'known-intermittent': 'Known intermittent',
};

const ICON: Record<Verdict, string> = {
  'likely-regression': '🔴',
  'shared-state-race': '🟠',
  'env-resource': '🟡',
  'known-intermittent': '⚪',
};

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Escapes text for Markdown inline context, including table cells. Also defuses @mentions. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]|~])/g, '\\$1')
    .replace(/@(?=\w)/g, '@​');
}

/** Escapes text for an HTML context such as `<summary>`, where Markdown is not rendered. */
export function escapeHtml(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/@(?=\w)/g, '@​');
}

/** Wraps text as inline code, choosing a fence that the text cannot close. */
export function inlineCode(text: string): string {
  const clean = text.replace(/\r?\n/g, ' ');
  const longest = Math.max(0, ...(clean.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = clean.startsWith('`') || clean.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${clean}${pad}${fence}`;
}

/** Findings sorted by verdict priority, then confidence (high first), then file and line. */
export function sortFindings(items: MergedClassification[]): MergedClassification[] {
  return [...items].sort(
    (a, b) =>
      VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict) ||
      CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.project.localeCompare(b.project),
  );
}

function displayTitle(c: MergedClassification): string {
  return c.titlePath.length > 0 ? c.titlePath.join(' › ') : c.title;
}

function location(c: MergedClassification): string {
  return inlineCode(`${c.file}:${c.line}`);
}

/** Link to the workflow run's artifacts section, or null when there is no CI info. */
export function artifactsUrl(result: MergedResult, context: RenderContext): string | null {
  const ci = result.reports.find((r) => r.ci?.runId)?.ci ?? null;
  const serverUrl = context.serverUrl || ci?.serverUrl;
  const repository = context.repository || ci?.repository;
  const runId = context.runId || ci?.runId;
  if (!serverUrl || !repository || !runId) return null;
  return `${serverUrl.replace(/\/+$/, '')}/${repository}/actions/runs/${runId}#artifacts`;
}

function shardLabel(reports: ReportSource[]): string | null {
  const shards = reports.map((r) => r.shard).filter((s): s is NonNullable<ReportSource['shard']> => s !== null);
  if (reports.length <= 1 && shards.length === 0) return null;
  if (shards.length === 0) return `${plural(reports.length, 'report')} merged`;
  const total = Math.max(...shards.map((s) => s.total));
  const seen = [...new Set(shards.map((s) => s.current))].sort((a, b) => a - b);
  const missing = total - seen.length;
  const base = `${seen.length} of ${plural(total, 'shard')} (${seen.join(', ')})`;
  return missing > 0 ? `${base}, ${missing} missing` : base;
}

function footer(result: MergedResult, withDisclaimer: boolean): string {
  const parts: string[] = [];
  const git = result.reports.find((r) => r.git.headSha || r.git.sha)?.git;
  const sha = git?.headSha || git?.sha;
  if (sha) parts.push(`Commit ${inlineCode(sha.slice(0, 7))}`);
  const versions = [...new Set(result.reports.map((r) => r.playwrightVersion).filter(Boolean))];
  if (versions.length > 0) parts.push(`Playwright ${versions.map(escapeMarkdown).join(', ')}`);
  const shards = shardLabel(result.reports);
  if (shards) parts.push(shards);
  let text = parts.join(' · ');
  if (withDisclaimer) text += `${text ? '. ' : ''}Verdicts are hypotheses from deterministic rules, not root causes.`;
  return text ? `<sub>${text}</sub>` : '';
}

function headline(result: MergedResult): string {
  const s = result.summary;
  const workers = Math.max(0, ...result.reports.map((r) => r.workers));
  return `**${[`${s.flaky} flaky`, `${s.unexpected} failed`, plural(s.total, 'test'), plural(workers, 'worker')].join(' · ')}**`;
}

function verdictCounts(result: MergedResult): string {
  return VERDICTS.filter((v) => result.summary[v] > 0)
    .map((v) => `${ICON[v]} ${result.summary[v]} ${VERDICT_LABEL[v].toLowerCase()}`)
    .join(' · ');
}

function runErrorsNote(result: MergedResult): string | null {
  const errors = result.reports.reduce((n, r) => n + r.runErrors, 0);
  if (errors === 0) return null;
  return (
    `> [!WARNING]\n> ${plural(errors, 'error')} happened outside any test ` +
    '(global setup, worker teardown). See the Playwright output.'
  );
}

function tableRow(c: MergedClassification): string {
  const project = c.project ? ` · ${escapeMarkdown(c.project)}` : '';
  const test = `${escapeMarkdown(displayTitle(c))}<br>${location(c)}${project}`;
  return `| ${ICON[c.verdict]} ${VERDICT_LABEL[c.verdict]} | ${test} | ${c.confidence} |`;
}

function bullets(heading: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return [`**${heading}**`, '', ...items.map((item) => `- ${escapeMarkdown(item)}`), ''];
}

function details(c: MergedClassification, runArtifacts: string | null): string {
  const summary = `${ICON[c.verdict]} <b>${VERDICT_LABEL[c.verdict]}</b> (${c.confidence}): ${escapeHtml(displayTitle(c))}`;
  const outcome = c.outcome === 'flaky' ? 'flaky (passed on retry)' : 'failed on every attempt';
  const project = c.project ? ` · project ${inlineCode(c.project)}` : '';
  const lines = [
    '<details>',
    `<summary>${summary}</summary>`,
    '',
    `${location(c)}${project} · ${outcome}`,
    '',
    ...bullets('Evidence', c.evidence),
    ...bullets('Also observed', c.alsoObserved),
    ...bullets(
      'Checked',
      c.checked.map((line) => line.replace(/^Checked\s+(\w)/, (_, first: string) => first.toUpperCase())),
    ),
  ];
  if (c.attachments.length > 0) {
    const link = runArtifacts ? ` ([workflow run artifacts](${runArtifacts}))` : '';
    lines.push(`**Attachments**${link}`, '', ...c.attachments.map((p) => `- ${inlineCode(p)}`), '');
  }
  lines.push('</details>');
  return lines.join('\n');
}

const omittedNote = (omitted: number, where: string): string =>
  `_${plural(omitted, 'more test')} not shown ${where} to stay under the comment size limit. ` +
  'The full list is in the JSON file named by the `result-path` output._';

/** Renders the PR comment and job summary Markdown for a merged result. Pure. */
export function render(result: MergedResult, context: RenderContext = {}): string {
  const max = context.maxLength ?? MAX_BODY_LENGTH;
  const head = [COMMENT_MARKER, '### FlakeScope', ''];
  const warning = runErrorsNote(result);

  if (result.classifications.length === 0) {
    const lines = [...head, `No flaky or failing tests were found in ${plural(result.summary.total, 'test')}.`];
    if (warning) lines.push('', warning);
    const foot = footer(result, false);
    if (foot) lines.push('', foot);
    return lines.join('\n') + '\n';
  }

  const findings = sortFindings(result.classifications);
  const runArtifacts = artifactsUrl(result, context);
  const out = [...head, headline(result), '', verdictCounts(result), ''];
  if (warning) out.push(warning, '');
  out.push('| Verdict | Test | Confidence |', '| --- | --- | --- |');
  const foot = [footer(result, true)];

  // Room kept for the omission notes.
  const reserve = 500;
  const fits = (extra: string[]): boolean => [...out, ...extra, ...foot].join('\n').length + 1 + reserve <= max;

  let rows = 0;
  for (const c of findings) {
    const row = tableRow(c);
    if (!fits([row])) break;
    out.push(row);
    rows++;
  }
  if (rows < findings.length) out.push('', omittedNote(findings.length - rows, 'in the table'));
  out.push('');

  let shown = 0;
  for (const c of findings.slice(0, rows)) {
    const block = details(c, runArtifacts);
    if (!fits([block, ''])) break;
    out.push(block, '');
    shown++;
  }
  if (shown < findings.length) out.push(omittedNote(findings.length - shown, 'in detail'), '');
  out.push(...foot);
  return out.join('\n') + '\n';
}
