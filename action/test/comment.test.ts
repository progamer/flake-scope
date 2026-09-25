import { describe, expect, it } from 'vitest';
import { parseCommentMode, upsertComment, type CommentClient, type IssueComment } from '../src/comment.js';
import { COMMENT_MARKER } from '../src/render.js';

class FakeClient implements CommentClient {
  comments: IssueComment[] = [];
  calls: string[] = [];
  error: { status: number; message: string } | null = null;
  private nextId = 1000;

  constructor(existing: string[] = []) {
    this.comments = existing.map((body) => this.make(body));
  }

  private make(body: string): IssueComment {
    const id = this.nextId++;
    return { id, body, html_url: `https://github.com/o/r/pull/1#issuecomment-${id}` };
  }

  private fail(): void {
    if (this.error) throw Object.assign(new Error(this.error.message), { status: this.error.status });
  }

  rest = {
    issues: {
      listComments: async (p: { per_page?: number; page?: number }) => {
        this.calls.push(`list:${p.page}`);
        this.fail();
        const size = p.per_page ?? 30;
        const start = ((p.page ?? 1) - 1) * size;
        return { data: this.comments.slice(start, start + size) };
      },
      createComment: async (p: { body: string }) => {
        this.calls.push('create');
        this.fail();
        const c = this.make(p.body);
        this.comments.push(c);
        return { data: c };
      },
      updateComment: async (p: { comment_id: number; body: string }) => {
        this.calls.push(`update:${p.comment_id}`);
        this.fail();
        const c = this.comments.find((x) => x.id === p.comment_id)!;
        c.body = p.body;
        return { data: c };
      },
    },
  };
}

function logger() {
  const log = { infos: [] as string[], warnings: [] as string[] };
  return {
    log,
    sink: { info: (m: string) => log.infos.push(m), warning: (m: string) => log.warnings.push(m) },
  };
}

const body = `${COMMENT_MARKER}\n### FlakeScope\nnew`;
const base = { owner: 'o', repo: 'r', issueNumber: 1, body };

describe('upsertComment', () => {
  it('creates a comment when none exists', async () => {
    const client = new FakeClient(['unrelated']);
    const { sink } = logger();
    const res = await upsertComment({ ...base, client, mode: 'auto', hasFindings: true, log: sink });
    expect(res.action).toBe('created');
    expect(res.url).toMatch(/issuecomment-/);
    expect(client.calls).toEqual(['list:1', 'create']);
  });

  it('updates the existing marked comment, found on a later page', async () => {
    const filler = Array.from({ length: 150 }, (_, i) => `comment ${i}`);
    const client = new FakeClient([...filler, `${COMMENT_MARKER}\nold`]);
    const target = client.comments.at(-1)!;
    const { sink } = logger();
    const res = await upsertComment({ ...base, client, mode: 'auto', hasFindings: true, log: sink });
    expect(res).toEqual({ action: 'updated', url: target.html_url });
    expect(client.calls).toEqual(['list:1', 'list:2', `update:${target.id}`]);
    expect(target.body).toBe(body);
  });

  it('auto mode skips creating a comment with no findings', async () => {
    const client = new FakeClient();
    const { sink } = logger();
    const res = await upsertComment({ ...base, client, mode: 'auto', hasFindings: false, log: sink });
    expect(res).toEqual({ action: 'skipped', url: null });
    expect(client.calls).not.toContain('create');
  });

  it('auto mode still updates an existing comment with no findings', async () => {
    const client = new FakeClient([`${COMMENT_MARKER}\nold`]);
    const { sink } = logger();
    const res = await upsertComment({ ...base, client, mode: 'auto', hasFindings: false, log: sink });
    expect(res.action).toBe('updated');
  });

  it('always mode creates a comment with no findings', async () => {
    const client = new FakeClient();
    const { sink } = logger();
    const res = await upsertComment({ ...base, client, mode: 'always', hasFindings: false, log: sink });
    expect(res.action).toBe('created');
  });

  it('never mode makes no API calls', async () => {
    const client = new FakeClient([`${COMMENT_MARKER}\nold`]);
    const { sink } = logger();
    const res = await upsertComment({ ...base, client, mode: 'never', hasFindings: true, log: sink });
    expect(res.action).toBe('skipped');
    expect(client.calls).toEqual([]);
  });

  it('turns a 403 into a warning about permissions', async () => {
    const client = new FakeClient();
    client.error = { status: 403, message: 'Resource not accessible by integration' };
    const { log, sink } = logger();
    const res = await upsertComment({ ...base, client, mode: 'auto', hasFindings: true, log: sink });
    expect(res).toEqual({ action: 'failed', url: null });
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toContain('pull-requests: write');
  });

  it('turns other errors into a warning too', async () => {
    const client = new FakeClient();
    client.error = { status: 500, message: 'boom' };
    const { log, sink } = logger();
    const res = await upsertComment({ ...base, client, mode: 'always', hasFindings: true, log: sink });
    expect(res.action).toBe('failed');
    expect(log.warnings[0]).toContain('boom');
  });
});

describe('parseCommentMode', () => {
  it('defaults to auto and rejects unknown values', () => {
    expect(parseCommentMode('')).toBe('auto');
    expect(parseCommentMode(' Always ')).toBe('always');
    expect(() => parseCommentMode('sometimes')).toThrow(/auto, always, or never/);
  });
});
