import { describe, expect, it } from 'vitest';
import { collectCi, collectGit } from '../src/env.js';

const noGit = { git: () => null, readFile: () => null };

describe('collectCi', () => {
  it('returns null outside CI', () => {
    expect(collectCi({})).toBeNull();
    expect(collectCi({ CI: 'false' })).toBeNull();
  });

  it('reads GitHub Actions metadata', () => {
    expect(
      collectCi({
        GITHUB_ACTIONS: 'true',
        RUNNER_OS: 'Linux',
        RUNNER_ARCH: 'X64',
        GITHUB_REPOSITORY: 'example-org/example-app',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_WORKFLOW: 'CI',
        GITHUB_JOB: 'e2e',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '2',
      }),
    ).toEqual({
      provider: 'github-actions',
      runnerOs: 'Linux',
      runnerArch: 'X64',
      repository: 'example-org/example-app',
      serverUrl: 'https://github.com',
      workflow: 'CI',
      jobId: 'e2e',
      runId: '123',
      runAttempt: '2',
    });
  });

  it('marks other CI providers as unknown', () => {
    expect(collectCi({ CI: 'true' })?.provider).toBe('unknown');
  });
});

describe('collectGit', () => {
  it('uses GitHub env on pull_request events, with head sha from the event payload', () => {
    const git = collectGit(
      {
        GITHUB_SHA: 'merge123',
        GITHUB_REF: 'refs/pull/42/merge',
        GITHUB_HEAD_REF: 'feature/x',
        GITHUB_REF_NAME: '42/merge',
        GITHUB_EVENT_PATH: '/tmp/event.json',
      },
      '/repo',
      {
        git: () => 'should-not-be-used',
        readFile: () => JSON.stringify({ pull_request: { head: { sha: 'head456' } } }),
      },
    );
    expect(git).toEqual({ sha: 'merge123', headSha: 'head456', branch: 'feature/x', pullRequest: 42 });
  });

  it('uses GitHub env on push events', () => {
    expect(
      collectGit({ GITHUB_SHA: 'abc', GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main' }, '/r', noGit),
    ).toEqual({
      sha: 'abc',
      headSha: null,
      branch: 'main',
      pullRequest: null,
    });
  });

  it('falls back to local git', () => {
    const answers: Record<string, string> = { 'rev-parse HEAD': 'local1', 'rev-parse --abbrev-ref HEAD': 'dev' };
    const git = collectGit({}, '/r', { git: (args) => answers[args.join(' ')] ?? null, readFile: () => null });
    expect(git).toEqual({ sha: 'local1', headSha: null, branch: 'dev', pullRequest: null });
  });

  it('reports a detached HEAD as no branch, and no git at all as nulls', () => {
    const detached = collectGit({}, '/r', {
      git: (a) => (a.includes('--abbrev-ref') ? 'HEAD' : 'sha'),
      readFile: () => null,
    });
    expect(detached.branch).toBeNull();
    expect(collectGit({}, '/r', noGit)).toEqual({ sha: null, headSha: null, branch: null, pullRequest: null });
  });

  it('tolerates a malformed event payload', () => {
    const git = collectGit({ GITHUB_SHA: 's', GITHUB_EVENT_PATH: '/e' }, '/r', {
      git: () => null,
      readFile: () => '{not json',
    });
    expect(git.sha).toBe('s');
    expect(git.headSha).toBeNull();
  });
});
