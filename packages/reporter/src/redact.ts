export const REDACTED = '[REDACTED]';

export interface RedactOptions {
  /** Environment to scan for secret-looking variables whose values must never appear. */
  env?: Record<string, string | undefined>;
  /** Extra env var names whose values must be redacted, regardless of their name. */
  redactEnv?: string[];
  /** Extra patterns to redact. Strings are matched literally. */
  patterns?: (string | RegExp)[];
  /** Absolute path prefixes to replace with `<root>` (avoids leaking usernames/home dirs). */
  pathRoots?: string[];
}

const SECRET_ENV_NAME =
  /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|COOKIE|SESSION|AUTH)/i;
const MIN_ENV_SECRET_LENGTH = 8;

// Order matters: specific token shapes before the generic key=value rules.
const BUILTIN_RULES: [RegExp, string][] = [
  // HTTP headers carrying credentials, e.g. `Authorization: Bearer x`, `cookie=...`.
  [
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token)(["']?\s*[:=]\s*["']?)[^\r\n"']+/gi,
    `$1$2${REDACTED}`,
  ],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  // Well-known token formats.
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, REDACTED],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, REDACTED],
  // Credentials embedded in URLs: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, `$1${REDACTED}@`],
  // Secret-ish query parameters.
  [
    /([?&](?:access_token|id_token|refresh_token|token|api_key|apikey|key|secret|client_secret|password|passwd|pwd|sig|signature|code|auth|session|sessionid)=)[^&#\s"']+/gi,
    `$1${REDACTED}`,
  ],
  // "password": "x"  /  password='x'
  [
    /(["']?\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)(["'])(?:(?!\2)[^\\]|\\.)*\2/gi,
    `$1$2${REDACTED}$2`,
  ],
  // password=x (unquoted)
  [
    /(\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*=\s*)[^\s&"',;]+/gi,
    `$1${REDACTED}`,
  ],
];

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type Redactor = (text: string) => string;

export function createRedactor(options: RedactOptions = {}): Redactor {
  const env = options.env ?? {};
  const forced = new Set(options.redactEnv ?? []);

  // Literal secret values from the environment, longest first so overlaps redact fully.
  const envSecrets = Object.entries(env)
    .filter(([name, value]) => {
      if (!value) return false;
      if (forced.has(name)) return true;
      return SECRET_ENV_NAME.test(name) && value.length >= MIN_ENV_SECRET_LENGTH;
    })
    .map(([name, value]) => ({ name, value: value as string }))
    .sort((a, b) => b.value.length - a.value.length);

  const extra = (options.patterns ?? []).map((p) =>
    typeof p === 'string'
      ? new RegExp(escapeRegExp(p), 'g')
      : new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g'),
  );

  // Longest roots first; match either slash style so Windows stack traces are covered.
  const roots = [...new Set(options.pathRoots ?? [])]
    .filter((r) => r.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((root) => {
      const trimmed = root.replace(/[\\/]+$/, '');
      const pattern = escapeRegExp(trimmed).replace(/\\\\|\//g, '[\\\\/]');
      // file:///C:/… URLs too.
      return new RegExp(`(?:file:\\/\\/\\/?)?${pattern}`, process.platform === 'win32' ? 'gi' : 'g');
    });

  return (input: string): string => {
    let text = input;
    for (const { name, value } of envSecrets) {
      text = text.split(value).join(`[REDACTED:${name}]`);
    }
    for (const [pattern, replacement] of BUILTIN_RULES) {
      text = text.replace(pattern, replacement);
    }
    for (const pattern of extra) {
      text = text.replace(pattern, REDACTED);
    }
    for (const root of roots) {
      text = text.replace(root, '<root>');
    }
    return text;
  };
}
