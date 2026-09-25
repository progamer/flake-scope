import { COMMENT_MARKER } from './render.js';

export type CommentMode = 'auto' | 'always' | 'never';

export interface IssueComment {
  id: number;
  body?: string | null;
  html_url: string;
}

/** The subset of Octokit's `rest.issues` API this module uses. */
export interface CommentClient {
  rest: {
    issues: {
      listComments(params: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page?: number;
        page?: number;
      }): Promise<{ data: IssueComment[] }>;
      createComment(params: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      }): Promise<{ data: IssueComment }>;
      updateComment(params: {
        owner: string;
        repo: string;
        comment_id: number;
        body: string;
      }): Promise<{ data: IssueComment }>;
    };
  };
}

export interface CommentLogger {
  info(message: string): void;
  warning(message: string): void;
}

export interface UpsertOptions {
  client: CommentClient;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  mode: CommentMode;
  hasFindings: boolean;
  log: CommentLogger;
}

export interface UpsertResult {
  action: 'created' | 'updated' | 'skipped' | 'failed';
  url: string | null;
}

const PAGE_SIZE = 100;

export function parseCommentMode(value: string): CommentMode {
  const mode = value.trim().toLowerCase() || 'auto';
  if (mode === 'auto' || mode === 'always' || mode === 'never') return mode;
  throw new Error(`Invalid "comment" input "${value}". Use auto, always, or never.`);
}

/** Finds this action's previous comment on the pull request by its hidden marker. */
export async function findExistingComment(
  client: CommentClient,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueComment | null> {
  for (let page = 1; ; page++) {
    const { data } = await client.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: PAGE_SIZE,
      page,
    });
    const match = data.find((c) => c.body?.includes(COMMENT_MARKER));
    if (match) return match;
    if (data.length < PAGE_SIZE) return null;
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/**
 * Creates or updates the FlakeScope comment according to `mode`. Never throws: API failures
 * become warnings, because a missing comment must not fail the test job.
 */
export async function upsertComment(options: UpsertOptions): Promise<UpsertResult> {
  const { client, owner, repo, issueNumber, body, mode, hasFindings, log } = options;
  if (mode === 'never') return { action: 'skipped', url: null };

  try {
    const existing = await findExistingComment(client, owner, repo, issueNumber);
    if (existing) {
      const { data } = await client.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
      log.info(`Updated FlakeScope comment ${data.html_url}`);
      return { action: 'updated', url: data.html_url };
    }
    if (mode === 'auto' && !hasFindings) {
      log.info('No flaky or failing tests, so no pull request comment was created (comment: auto).');
      return { action: 'skipped', url: null };
    }
    const { data } = await client.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    log.info(`Created FlakeScope comment ${data.html_url}`);
    return { action: 'created', url: data.html_url };
  } catch (error) {
    const status = statusOf(error);
    const message = error instanceof Error ? error.message : String(error);
    if (status === 403 || status === 404) {
      log.warning(
        `FlakeScope could not comment on pull request #${issueNumber} (HTTP ${status}: ${message}). ` +
          'The token needs the "pull-requests: write" permission; add it under "permissions:" in the workflow job. ' +
          'Pull requests from forks get a read-only token, so there the results are only in the job summary.',
      );
    } else {
      log.warning(`FlakeScope could not comment on pull request #${issueNumber}: ${message}`);
    }
    return { action: 'failed', url: null };
  }
}
