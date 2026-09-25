import type { Attempt, ReportedError } from '@codept/flakescope-reporter';

export type ErrorKind = 'timeout' | 'connection' | 'crash' | 'resource' | 'other';

// Checked in order; the first match wins. `timeout` is last so a crash that
// also mentions a timeout is reported as a crash.
const KIND_PATTERNS: [Exclude<ErrorKind, 'other'>, RegExp][] = [
  ['resource', /JavaScript heap out of memory|\bENOMEM\b|\bENOSPC\b|\bEMFILE\b|out of memory|no space left on device/i],
  [
    'crash',
    /Target (page, context or browser has been closed|crashed)|browser has (been closed|disconnected)|Page crashed|Browser closed|Target closed|worker process exited unexpectedly|\bSIG(KILL|SEGV|ABRT)\b/i,
  ],
  [
    'connection',
    /\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|\bEAI_AGAIN\b|\bENOTFOUND\b|net::ERR_[A-Z_]+|NS_ERROR_NET|socket hang up|getaddrinfo/,
  ],
  // Deliberately NOT matching expect()'s "Timeout: 2000ms" line: an assertion that
  // waited and saw the wrong value is not a timeout.
  ['timeout', /Test timeout of \d+ms exceeded|Timeout \d+ms exceeded|timed out after \d+ ?ms|Navigation timeout/i],
];

export function errorKind(error: ReportedError): ErrorKind {
  const text = `${error.message}\n${error.stack ?? ''}`;
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return 'other';
}

/** Kind of an attempt's failure. A `timedOut` status is a timeout even if the message doesn't say so. */
export function attemptKind(attempt: Attempt): ErrorKind {
  const kinds = attempt.errors.map(errorKind);
  const specific = kinds.find((k) => k !== 'other' && k !== 'timeout');
  if (specific) return specific;
  if (kinds.includes('timeout') || attempt.status === 'timedOut') return 'timeout';
  return 'other';
}

/** Replace run-specific values so the same failure matches across attempts and runs. */
export function normalize(text: string): string {
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\b\d+(\.\d+)?\s?(ms|s)\b/g, '<duration>')
    .replace(/:\d{2,5}\b/g, ':<port>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim() !== '') ?? '';
}

/** Error first line + source location. Two errors with the same fingerprint are "the same error". */
export function fingerprint(error: ReportedError): string {
  const loc = error.location ? `${error.location.file}:${error.location.line}:${error.location.column}` : '?';
  return `${normalize(firstLine(error.message))} @ ${loc}`;
}

/** Whole message minus Playwright's call log (which varies with retry counts). */
export function messageKey(error: ReportedError): string {
  return normalize(error.message.split(/\n\s*Call log:/)[0] ?? '');
}

export function attemptFingerprint(attempt: Attempt): string | null {
  const first = attempt.errors[0];
  return first ? fingerprint(first) : null;
}

/** Short human description of an attempt's first error, for evidence strings. */
export function describeError(attempt: Attempt): string {
  const first = attempt.errors[0];
  if (!first) return attempt.status === 'timedOut' ? 'timed out' : attempt.status;
  const loc = first.location ? ` at ${first.location.file}:${first.location.line}` : '';
  let line = firstLine(first.message).trim();
  if (line.length > 120) line = line.slice(0, 117) + '...';
  return `"${line}"${loc}`;
}
