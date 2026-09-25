import type { Attempt, ReportedTest } from '@flakescope/reporter';
import { attemptFingerprint, attemptKind, describeError, messageKey, type ErrorKind } from './errors.js';
import type { RuleResult, Signal, Strength } from './types.js';

export const isFailed = (a: Attempt): boolean => a.status === 'failed' || a.status === 'timedOut';
const ran = (a: Attempt): boolean => a.status !== 'skipped' && a.status !== 'interrupted';

/** A resource annotated by the user, as opposed to one inferred from storageState. */
const isExplicit = (resource: string): boolean => !resource.startsWith('storageState:');

/** The first attempt must be this many times slower than the passing one to count as "slow". */
export const SLOW_RATIO = 3;
export const SLOW_MIN_DIFF_MS = 1_000;

const KIND_LABEL: Record<ErrorKind, string> = {
  timeout: 'a timeout',
  connection: 'a connection error',
  crash: 'a browser/worker crash',
  resource: 'resource exhaustion',
  other: 'an assertion or application error',
};

// -----------------------------------------------------------------------------
// likely-regression: fails on every attempt with the same error.
// -----------------------------------------------------------------------------
export function regressionRule(test: ReportedTest): RuleResult {
  const attempts = test.attempts.filter(ran);
  const checked = 'whether every attempt failed with the same error';
  if (test.outcome !== 'unexpected' || attempts.length === 0 || !attempts.every(isFailed)) {
    return { signals: [], checked };
  }

  const n = attempts.length;
  const prints = new Set(attempts.map(attemptFingerprint));
  const first = attempts[0] as Attempt;
  const evidence: string[] = [];
  let strength: Strength;

  if (prints.size === 1) {
    evidence.push(
      n > 1
        ? `All ${n} attempts failed with ${describeError(first)}.`
        : `The only attempt failed with ${describeError(first)}.`,
    );
    if (new Set(attempts.map((a) => (a.errors[0] ? messageKey(a.errors[0]) : ''))).size === 1 && n > 1) {
      evidence.push('The full error message was identical on every attempt.');
    }
    strength = n >= 3 ? 3 : n === 2 ? 2 : 1;
    if (n === 1) {
      evidence.push('Only one attempt ran (retries: 0), so a regression cannot be told apart from a flake.');
    }
  } else {
    evidence.push(`All ${n} attempts failed, but with ${prints.size} different errors.`);
    strength = 1;
  }

  // Timeouts and infrastructure errors on every attempt are weaker evidence of a product bug.
  const kind = attemptKind(first);
  if (prints.size === 1 && kind !== 'other') {
    if (kind === 'timeout') {
      strength = Math.min(strength, 2) as Strength;
      evidence.push('The error is a timeout, which can also come from a slow environment.');
    } else {
      strength = 1;
      evidence.push(`The error is ${KIND_LABEL[kind]}, which points at the environment more than the code.`);
    }
  }

  return { signals: [{ verdict: 'likely-regression', strength, evidence }], checked };
}

// -----------------------------------------------------------------------------
// shared-state-race: a failing attempt overlapped another test that shares a resource.
// -----------------------------------------------------------------------------
export function raceRule(test: ReportedTest): RuleResult {
  const failed = test.attempts.filter(isFailed);
  const passed = test.attempts.filter((a) => a.status === 'passed');
  const overlapCount = failed.reduce((n, a) => n + a.concurrent.length, 0);
  const checked =
    `concurrent tests on other workers during failed attempts (${overlapCount} overlap${overlapCount === 1 ? '' : 's'})` +
    ` for shared resources (${test.resources.length ? test.resources.join(', ') : 'none declared'})`;

  const evidence: string[] = [];
  let explicit = false;
  let inferred = false;

  for (const attempt of failed) {
    for (const other of attempt.concurrent.filter((c) => c.sharedResources.length > 0)) {
      if (other.sharedResources.some(isExplicit)) explicit = true;
      else inferred = true;
      evidence.push(
        `Attempt ${attempt.retry} (worker ${attempt.workerIndex}) overlapped "${other.title}" (${other.file}, ` +
          `worker ${other.workerIndex}, ${other.status}) for ${other.overlapMs} ms; both use ${other.sharedResources.join(', ')}.`,
      );
    }
  }

  if (!explicit && !inferred) {
    // Weak signal only: failed alongside others, passed alone. Never enough on its own.
    const crowded = failed.filter((a) => a.concurrent.length > 0);
    const alone = passed.filter((a) => a.concurrent.length === 0);
    if (crowded.length > 0 && alone.length > 0 && crowded.length === failed.length) {
      return {
        signals: [
          {
            verdict: 'shared-state-race',
            strength: 1,
            evidence: [
              `Failed attempt${crowded.length > 1 ? 's' : ''} ran alongside other tests on other workers and ` +
                `attempt ${(alone[0] as Attempt).retry} passed with nothing running concurrently, ` +
                'but no shared resource was declared.',
            ],
          },
        ],
        checked,
      };
    }
    return { signals: [], checked };
  }

  let strength: Strength = explicit ? 3 : 2;
  if (!explicit) {
    evidence.push(
      'The only shared resource is the project storageState; many suites share one login, so this is weaker ' +
        'evidence than a declared flakescope:resource.',
    );
  }

  // A passing attempt tells us whether the shared resource really mattered.
  for (const attempt of passed) {
    const sharing = attempt.concurrent.filter((c) => c.sharedResources.length > 0);
    if (sharing.length === 0) {
      evidence.push(`Attempt ${attempt.retry} passed with no concurrent test sharing a resource.`);
    } else {
      strength = Math.max(1, strength - 1) as Strength;
      evidence.push(
        `Attempt ${attempt.retry} passed even though it overlapped ${sharing.length} test${sharing.length > 1 ? 's' : ''} ` +
          'sharing a resource, which weakens this signal.',
      );
    }
  }

  return { signals: [{ verdict: 'shared-state-race', strength, evidence }], checked };
}

// -----------------------------------------------------------------------------
// env-resource: timeouts, connection errors, crashes, OOM, slow first attempt.
// -----------------------------------------------------------------------------
export function envRule(test: ReportedTest): RuleResult {
  const failed = test.attempts.filter(isFailed);
  const passed = test.attempts.filter((a) => a.status === 'passed');
  const checked =
    'failed attempts for timeouts, connection errors, browser/worker crashes, and resource exhaustion; ' +
    `first-attempt duration vs. passing attempts (slow = ${SLOW_RATIO}x and +${SLOW_MIN_DIFF_MS} ms)`;

  const signals: Signal[] = [];
  const evidence: string[] = [];
  let strength = 0;

  const kinds = failed.map((a) => ({ attempt: a, kind: attemptKind(a) }));
  const infra = kinds.filter((k) => k.kind === 'connection' || k.kind === 'crash' || k.kind === 'resource');
  const timeouts = kinds.filter((k) => k.kind === 'timeout');

  for (const { attempt, kind } of [...infra, ...timeouts]) {
    evidence.push(`Attempt ${attempt.retry} failed with ${KIND_LABEL[kind]}: ${describeError(attempt)}.`);
  }
  if (infra.length > 0) strength = 3;
  else if (timeouts.length > 0) strength = 2;

  // Slow first attempt. Only compared against a passing attempt: failed assertions
  // that waited for expect's timeout are naturally slower and prove nothing.
  const first = test.attempts[0];
  const fastestPass = passed.reduce<Attempt | undefined>(
    (best, a) => (!best || a.durationMs < best.durationMs ? a : best),
    undefined,
  );
  if (first && fastestPass && isFailed(first)) {
    const ratio = first.durationMs / Math.max(1, fastestPass.durationMs);
    const firstKind = attemptKind(first);
    if (ratio >= SLOW_RATIO && first.durationMs - fastestPass.durationMs >= SLOW_MIN_DIFF_MS) {
      const line =
        `Attempt 0 took ${first.durationMs} ms; attempt ${fastestPass.retry} passed in ${fastestPass.durationMs} ms ` +
        `(${ratio.toFixed(1)}x faster).`;
      if (firstKind === 'timeout') {
        evidence.push(line + ' A slow first attempt that times out suggests a cold start or a busy runner.');
        strength = 3;
      } else if (firstKind === 'other') {
        // Weak on its own; recorded so reviewers can see it.
        signals.push({
          verdict: 'env-resource',
          strength: 1,
          evidence: [line + ' Weak on its own: a failed assertion waits for its timeout, so failures run longer.'],
        });
      }
    }
  }

  if (strength > 0) signals.unshift({ verdict: 'env-resource', strength: strength as Strength, evidence });
  return { signals, checked };
}
