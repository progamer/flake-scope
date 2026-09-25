import { describe, expect, it } from 'vitest';
import { createRedactor, REDACTED, stripAnsi } from '../src/redact.js';

describe('createRedactor', () => {
  const redact = createRedactor();

  it.each([
    ['Authorization: Bearer abc.def.ghi123456', 'Authorization: ' + REDACTED],
    ['headers: {"cookie": "sid=abc123; theme=dark"}', `headers: {"cookie": "${REDACTED}"}`],
    ['set-cookie=session=xyz', 'set-cookie=' + REDACTED],
    ['x-api-key: 1234567890', 'x-api-key: ' + REDACTED],
  ])('redacts credential headers: %s', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it('redacts bearer tokens outside headers', () => {
    expect(redact('sent Bearer abcdefgh12345678 upstream')).toBe(`sent Bearer ${REDACTED} upstream`);
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redact(`token was ${jwt}!`)).toBe(`token was ${REDACTED}!`);
  });

  it.each([
    'ghp_' + 'a'.repeat(36),
    'github_pat_' + 'A1_'.repeat(10),
    'AKIA' + 'ABCDEFGHIJKLMNOP',
    'xoxb-1234567890-abcdef',
    'sk_live_' + 'x'.repeat(24),
    'sk-proj-' + 'y'.repeat(30),
  ])('redacts well-known token format %s', (token) => {
    expect(redact(`value=${token} end`)).not.toContain(token);
  });

  it('redacts credentials embedded in URLs', () => {
    expect(redact('GET https://alice:hunter2@example.com/path')).toBe(
      `GET https://${REDACTED}@example.com/path`,
    );
  });

  it('redacts secret query parameters but keeps the rest of the URL', () => {
    expect(redact('https://app.test/cb?code=abc123&state=ok&access_token=zzz#x')).toBe(
      `https://app.test/cb?code=${REDACTED}&state=ok&access_token=${REDACTED}#x`,
    );
  });

  it('redacts quoted and unquoted password assignments', () => {
    expect(redact(`{"password": "p@ss\\"word", "user": "alice"}`)).toBe(
      `{"password": "${REDACTED}", "user": "alice"}`,
    );
    expect(redact('login password=hunter2 ok')).toBe(`login password=${REDACTED} ok`);
  });

  it('leaves ordinary test output alone', () => {
    const msg = 'expect(locator).toHaveText(expected) failed\nExpected: "Alice-A"\nReceived: "Alice-B"';
    expect(redact(msg)).toBe(msg);
  });

  it('redacts values of secret-looking env vars wherever they appear', () => {
    const r = createRedactor({
      env: { API_TOKEN: 'supersecretvalue', HOME: '/home/alice', SHORT_TOKEN: 'abc', PLAIN: 'visible-value' },
    });
    expect(r('got supersecretvalue and visible-value and abc')).toBe(
      'got [REDACTED:API_TOKEN] and visible-value and abc',
    );
  });

  it('redacts values of explicitly listed env vars regardless of name', () => {
    const r = createRedactor({ env: { TEST_USER_EMAIL: 'qa@corp.example' }, redactEnv: ['TEST_USER_EMAIL'] });
    expect(r('logged in as qa@corp.example')).toBe('logged in as [REDACTED:TEST_USER_EMAIL]');
  });

  it('applies custom string and regexp patterns', () => {
    const r = createRedactor({ patterns: ['acct-4242', /order-\d+/] });
    expect(r('acct-4242 placed order-17 and order-18')).toBe(`${REDACTED} placed ${REDACTED} and ${REDACTED}`);
  });

  it('replaces absolute path roots with <root>, either slash style', () => {
    const r = createRedactor({ pathRoots: ['C:\\Users\\alice\\proj'] });
    expect(r('at C:\\Users\\alice\\proj\\tests\\a.spec.ts:3:5')).toBe('at <root>\\tests\\a.spec.ts:3:5');
    expect(r('at file:///C:/Users/alice/proj/tests/a.spec.ts:3:5')).toBe('at <root>/tests/a.spec.ts:3:5');
    const posix = createRedactor({ pathRoots: ['/home/alice/proj/'] });
    expect(posix('at /home/alice/proj/tests/a.spec.ts:3:5')).toBe('at <root>/tests/a.spec.ts:3:5');
  });
});

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\u001b[31mExpected\u001b[39m: 1')).toBe('Expected: 1');
  });
});
