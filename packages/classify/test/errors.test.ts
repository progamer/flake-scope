import type { Attempt, ReportedError } from '@codept/flakescope-reporter';
import { describe, expect, it } from 'vitest';
import { attemptKind, errorKind, fingerprint, messageKey, normalize } from '../src/errors.js';

const e = (message: string, line = 3): ReportedError => ({
  message,
  stack: null,
  location: { file: 'tests/a.spec.ts', line, column: 5 },
});

describe('errorKind', () => {
  it.each([
    ['Test timeout of 30000ms exceeded.', 'timeout'],
    ['page.goto: Timeout 30000ms exceeded.', 'timeout'],
    ['connect ECONNREFUSED 127.0.0.1:3000', 'connection'],
    ['page.goto: net::ERR_CONNECTION_RESET at http://x', 'connection'],
    ['Target page, context or browser has been closed', 'crash'],
    ['Browser closed.', 'crash'],
    ['FATAL ERROR: JavaScript heap out of memory', 'resource'],
    ['ENOSPC: no space left on device, write', 'resource'],
  ])('%s -> %s', (message, kind) => {
    expect(errorKind(e(message))).toBe(kind);
  });

  it('does not treat the Timeout line of an expect() failure as a timeout', () => {
    const msg = 'expect(locator).toHaveText(expected) failed\n\nExpected: "A"\nReceived: "B"\nTimeout:  2000ms';
    expect(errorKind(e(msg))).toBe('other');
  });

  it('prefers a crash over a timeout mentioned in the same error', () => {
    expect(errorKind(e('Test timeout of 5000ms exceeded.\nBrowser closed.'))).toBe('crash');
  });
});

describe('attemptKind', () => {
  const attempt = (status: Attempt['status'], errors: ReportedError[]): Attempt => ({
    retry: 0,
    status,
    workerIndex: 0,
    parallelIndex: 0,
    startTime: '',
    durationMs: 0,
    errors,
    attachments: [],
    concurrent: [],
    concurrentTruncated: false,
  });

  it('treats a timedOut status as a timeout even without a matching message', () => {
    expect(attemptKind(attempt('timedOut', [e('something')]))).toBe('timeout');
  });

  it('lets a specific infrastructure error win over a timeout', () => {
    expect(attemptKind(attempt('timedOut', [e('Test timeout of 5000ms exceeded.'), e('Browser closed.')]))).toBe(
      'crash',
    );
  });
});

describe('fingerprint', () => {
  it('matches the same error despite run-specific values', () => {
    const a = e('Error: order 1234 not found (id 3f2a9c1e-1111-2222-3333-444455556666) after 350ms');
    const b = e('Error: order 98 not found (id 00000000-aaaa-bbbb-cccc-dddddddddddd) after 12ms');
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('distinguishes different locations', () => {
    expect(fingerprint(e('Error: boom', 3))).not.toBe(fingerprint(e('Error: boom', 4)));
  });

  it('uses only the first line; messageKey compares the whole message without the call log', () => {
    const a = e('Error: expect failed\nExpected: "A"\nReceived: "B"\n\nCall log:\n  - 19 x resolved');
    const b = e('Error: expect failed\nExpected: "A"\nReceived: "C"\n\nCall log:\n  - 3 x resolved');
    const c = e('Error: expect failed\nExpected: "A"\nReceived: "B"\n\nCall log:\n  - 7 x resolved');
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(messageKey(a)).not.toBe(messageKey(b));
    expect(messageKey(a)).toBe(messageKey(c));
  });
});

describe('normalize', () => {
  it('replaces uuids, long hex, durations, ports, and numbers', () => {
    expect(normalize('GET http://h:4173/x/deadbeefcafe1234 took 12.5 ms, retry 3')).toBe(
      'GET http://h:<port>/x/<hex> took <duration>, retry <n>',
    );
  });
});
