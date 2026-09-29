/**
 * Social Connections domain — dependency-free validation schemas.
 *
 * Same ValidationResult shape as src/domain/campaigns/schemas.ts. Every
 * validator is pure so guards and services stay unit-testable without a
 * runtime.
 */
import type {
  SocialConnectionMetadata,
  SocialConnectionStatus,
} from './types';

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

function fail(error: string): ValidationResult<never> {
  return { ok: false, errors: [error] };
}

function pass<T>(value: T): ValidationResult<T> {
  return { ok: true, value, errors: [] };
}

const PROVIDER_KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
/** Server-only env names, echoed for docs/tests — values never live here. */
export const SOCIAL_PROVIDER_KEYS = [
  'meta',
  'tiktok',
  'youtube',
  'linkedin',
  'x',
  'pinterest',
  'dev_fake',
] as const;

const CONNECTION_STATUSES: SocialConnectionStatus[] = [
  'pending',
  'connected',
  'needs_reauth',
  'revoked',
  'failed',
  'disconnected',
];

export function isProviderKey(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_KEY_RE.test(value);
}

export function validateProviderKey(value: unknown): ValidationResult<string> {
  if (!isProviderKey(value)) {
    return fail('Provider key must be 2–30 lowercase letters, digits or underscores.');
  }
  return pass(value);
}

export function validateLocalName(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') return fail('Name is required.');
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    return fail('Name must be between 1 and 80 characters.');
  }
  // Strip control characters from user-supplied display names.
  // eslint-disable-next-line no-control-regex
  const clean = trimmed.replace(/[\u0000-\u001f\u007f]/g, '');
  return pass(clean);
}

export function validateConnectionStatus(value: unknown): ValidationResult<SocialConnectionStatus> {
  if (typeof value !== 'string' || !CONNECTION_STATUSES.includes(value as SocialConnectionStatus)) {
    return fail('Unknown connection status.');
  }
  return pass(value as SocialConnectionStatus);
}

/** Metadata allowlist: flat string/number/boolean, keys ≤40 chars, no nesting. */
export function sanitizeConnectionMetadata(
  input: unknown,
): SocialConnectionMetadata {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = rawKey.slice(0, 40);
    if (
      typeof rawValue === 'string' ||
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean'
    ) {
      if (typeof rawValue === 'string') {
        // Redact anything that looks like a secret/credential value.
        if (/token|secret|code|password|bearer|key/i.test(key) && key !== 'safeKey') {
          out[key] = '[redacted]';
        } else {
          out[key] = rawValue.slice(0, 200);
        }
      } else {
        out[key] = rawValue;
      }
    }
  }
  return out;
}

/**
 * Safe provider error mapping — redacts anything that could carry tokens,
 * codes or signed payloads into a short user-safe message + stable code.
 */
const SAFE_ERROR_PATTERNS: Array<{ match: RegExp; code: string; message: string }> = [
  {
    match: /invalid_grant|expired|revoked/i,
    code: 'grant_invalid',
    message: 'The provider authorization has expired or was revoked. Please reconnect.',
  },
  {
    match: /scope|permission/i,
    code: 'insufficient_permissions',
    message: "We couldn't verify the permissions for this account.",
  },
  {
    match: /network|fetch|timeout|ECONN/i,
    code: 'provider_unreachable',
    message: 'This provider connection needs to be tried again.',
  },
];

export function mapSafeProviderError(raw: unknown): { code: string; message: string } {
  const text =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : JSON.stringify(raw ?? '').slice(0, 400);
  for (const entry of SAFE_ERROR_PATTERNS) {
    if (entry.match.test(text)) {
      return { code: entry.code, message: entry.message };
    }
  }
  return { code: 'connection_failed', message: 'This provider connection needs to be tried again.' };
}

/** Redacts any token/code-shaped value out of free text before logging/UI. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(access_token|refresh_token|authorization_code|bearer)\b\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]');
}
