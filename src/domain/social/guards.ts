/**
 * Social Connections domain — guards.
 *
 * Pure, framework-free state machine and security guards: status
 * transitions, OAuth state validation (single-use, expiry, workspace/
 * provider pairing) and redirect-URI allowlist enforcement. Hashing uses
 * the WebCrypto-compatible async signature so the same code runs in the
 * browser, Node 18+ and edge runtimes.
 */

import type { SocialConnectionStatus, SocialOauthStateRecord } from './types';

export class SocialConnectionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocialConnectionStateError';
  }
}

// ── Status machine ──────────────────────────────────────────────────────────

export const SOCIAL_CONNECTION_TRANSITIONS: Record<
  SocialConnectionStatus,
  SocialConnectionStatus[]
> = {
  pending: ['connected', 'failed', 'disconnected'],
  connected: ['needs_reauth', 'revoked', 'failed', 'disconnected'],
  needs_reauth: ['connected', 'revoked', 'failed', 'disconnected'],
  revoked: ['disconnected'],
  failed: ['connected', 'disconnected'],
  disconnected: [],
};

export function canTransitionSocialConnection(
  from: SocialConnectionStatus,
  to: SocialConnectionStatus,
): boolean {
  return SOCIAL_CONNECTION_TRANSITIONS[from].includes(to);
}

export function assertSocialTransition(
  from: SocialConnectionStatus,
  to: SocialConnectionStatus,
): void {
  if (!canTransitionSocialConnection(from, to)) {
    throw new SocialConnectionStateError(
      `A social connection cannot move from ${from} to ${to}.`,
    );
  }
}

// ── Hashing (async — WebCrypto across browser/Node/edge) ────────────────────

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Cryptographically random URL-safe token (state / verifier material). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── OAuth state validation ──────────────────────────────────────────────────

export interface OauthStateCheck {
  ok: boolean;
  reason?: 'expired' | 'consumed' | 'provider_mismatch' | 'workspace_mismatch' | 'hash_mismatch';
}

/**
 * Validates a callback against the stored state record:
 * same provider + workspace, not consumed (single-use), not expired and
 * hash-equal to the presented plain state token.
 */
export async function validateOauthState(
  stored: Pick<
    SocialOauthStateRecord,
    'providerKey' | 'workspaceId' | 'expiresAt' | 'consumedAt' | 'stateTokenHash'
  >,
  presented: {
    providerKey: string;
    workspaceId: string;
    plainStateToken: string;
    now?: Date;
  },
): Promise<OauthStateCheck> {
  if (stored.providerKey !== presented.providerKey) {
    return { ok: false, reason: 'provider_mismatch' };
  }
  if (stored.workspaceId !== presented.workspaceId) {
    return { ok: false, reason: 'workspace_mismatch' };
  }
  if (stored.consumedAt !== null) {
    return { ok: false, reason: 'consumed' };
  }
  const now = presented.now ?? new Date();
  if (new Date(stored.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  const hash = await sha256Hex(presented.plainStateToken);
  if (hash !== stored.stateTokenHash) {
    return { ok: false, reason: 'hash_mismatch' };
  }
  return { ok: true };
}

// ── Redirect URI allowlist ──────────────────────────────────────────────────

/**
 * Per-provider redirect allowlist. Phase 1: the callback path is fixed and
 * the origin must match the configured base URL (demo mode: current origin).
 * Production providers add their platform-registered URIs here.
 */
export const ALLOWED_REDIRECT_PATHS = [
  '/settings/connections/callback/meta',
  '/settings/connections/callback/tiktok',
  '/settings/connections/callback/youtube',
  '/settings/connections/callback/linkedin',
  '/settings/connections/callback/dev_fake',
];

export function isAllowedRedirectUri(uri: string, origin: string): boolean {
  try {
    const parsed = new URL(uri);
    const base = new URL(origin);
    if (parsed.origin !== base.origin) return false;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return ALLOWED_REDIRECT_PATHS.includes(parsed.pathname);
  } catch {
    return false;
  }
}

/** OAuth states expire aggressively. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function oauthStateExpiry(now = new Date()): string {
  return new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString();
}

/** Dev-only adapters must never be presented as production platforms. */
export function assertNotDevOnlyMasquerade(
  provider: { providerKey: string; devOnly: boolean },
  isProductionContext: boolean,
): void {
  if (isProductionContext && provider.devOnly) {
    throw new SocialConnectionStateError(
      'The development fake provider cannot be used in a production context.',
    );
  }
}
