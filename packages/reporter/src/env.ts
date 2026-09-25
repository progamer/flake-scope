import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import type { CiInfo, GitInfo, HostInfo } from './schema.js';

type Env = Record<string, string | undefined>;

export function collectCi(env: Env): CiInfo | null {
  if (env.GITHUB_ACTIONS === 'true') {
    return {
      provider: 'github-actions',
      runnerOs: env.RUNNER_OS ?? null,
      runnerArch: env.RUNNER_ARCH ?? null,
      repository: env.GITHUB_REPOSITORY ?? null,
      serverUrl: env.GITHUB_SERVER_URL ?? null,
      workflow: env.GITHUB_WORKFLOW ?? null,
      jobId: env.GITHUB_JOB ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    };
  }
  if (env.CI && env.CI !== 'false' && env.CI !== '0') {
    return {
      provider: 'unknown',
      runnerOs: null,
      runnerArch: null,
      repository: null,
      serverUrl: null,
      workflow: null,
      jobId: null,
      runId: null,
      runAttempt: null,
    };
  }
  return null;
}

export interface GitDeps {
  /** Runs `git <args>` in cwd; returns trimmed stdout or null. Injected for tests. */
  git?: (args: string[]) => string | null;
  /** Reads a file as text or returns null. Injected for tests. */
  readFile?: (path: string) => string | null;
}

function defaultGit(cwd: string) {
  return (args: string[]): string | null => {
    try {
      const out = execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
        windowsHide: true,
      }).trim();
      return out || null;
    } catch {
      return null;
    }
  };
}

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function collectGit(env: Env, cwd: string, deps: GitDeps = {}): GitInfo {
  const git = deps.git ?? defaultGit(cwd);
  const readFile = deps.readFile ?? defaultReadFile;

  const prMatch = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '');
  let pullRequest = prMatch ? Number(prMatch[1]) : null;
  let headSha: string | null = null;

  // pull_request events: GITHUB_SHA is the merge commit; the head commit lives in the event payload.
  if (env.GITHUB_EVENT_PATH) {
    const raw = readFile(env.GITHUB_EVENT_PATH);
    if (raw) {
      try {
        const event = JSON.parse(raw) as { pull_request?: { number?: number; head?: { sha?: string } } };
        headSha = event.pull_request?.head?.sha ?? null;
        pullRequest ??= event.pull_request?.number ?? null;
      } catch {
        // Malformed payload: fall through with what we have.
      }
    }
  }

  const sha = env.GITHUB_SHA || git(['rev-parse', 'HEAD']);
  let branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') branch = null; // detached

  return { sha: sha ?? null, headSha, branch: branch ?? null, pullRequest };
}

export function collectHost(): HostInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.availableParallelism?.() ?? os.cpus().length,
    nodeVersion: process.version,
  };
}
