/**
 * Social Connections domain — types.
 *
 * Connection MANAGEMENT only: providers, workspace connections, server-side
 * tokens, OAuth handshake states and an append-only audit timeline. No
 * publishing, no scheduled posts, no platform media containers, no billing.
 *
 * Security posture encoded in these types:
 *   * Token record types never carry raw token values — decrypted material
 *     exists only inside the service boundary as `SocialTokenMaterial`.
 *   * OAuth state records carry the state *hash*, never the plain state.
 *   * Provider-specific knowledge lives exclusively in adapters
 *     (SocialConnectionProvider implementations).
 */

export type SocialProviderStatus = 'available' | 'disabled' | 'dev_only';

export type SocialConnectionStatus =
  | 'pending'
  | 'connected'
  | 'needs_reauth'
  | 'revoked'
  | 'failed'
  | 'disconnected';

export type SocialConnectionEventType =
  | 'connect_started'
  | 'callback_received'
  | 'connected'
  | 'verification_passed'
  | 'verification_failed'
  | 'reauth_required'
  | 'refreshed'
  | 'disconnected'
  | 'revoke_requested'
  | 'revoke_succeeded'
  | 'revoke_failed'
  | 'provider_disabled';

/** Registry metadata — never secrets. */
export interface SocialProviderRecord {
  key: string;
  displayName: string;
  status: SocialProviderStatus;
  supportsRefresh: boolean;
  supportsDisconnectRevoke: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Audit-safe metadata: plain scalars only. */
export type SocialConnectionMetadata = Record<string, string | number | boolean> | null;

export interface SocialConnectionRecord {
  id: string;
  workspaceId: string;
  providerKey: string;
  localName: string;
  /** SHA-256 hex of the external account id — dedupe without exposure. */
  externalAccountIdHash: string;
  externalAccountLabel: string | null;
  externalAccountType: string | null;
  status: SocialConnectionStatus;
  grantedScopes: string[] | null;
  connectionMetadata: SocialConnectionMetadata;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  /** Sanitized, user-safe message — never a raw provider payload. */
  lastErrorMessageSafe: string | null;
  connectedBy: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Token record WITHOUT token values. Raw material never crosses this type;
 * the repository returns ciphertext ids/metadata only and hands decrypted
 * material to the service via a dedicated method.
 */
export interface SocialConnectionTokenRecord {
  id: string;
  workspaceSocialConnectionId: string;
  expiresAt: string | null;
  tokenMetadata: SocialConnectionMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface SocialOauthStateRecord {
  id: string;
  workspaceId: string;
  providerKey: string;
  /** SHA-256 hex — the plain state token is never stored or returned. */
  stateTokenHash: string;
  /** Ciphertext only — decrypted once, server-side, at callback time. */
  pkceVerifierEncrypted: string | null;
  requestedScopes: string[] | null;
  redirectUri: string;
  expiresAt: string;
  consumedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface SocialConnectionEventRecord {
  id: string;
  workspaceId: string;
  workspaceSocialConnectionId: string | null;
  actorId: string | null;
  providerKey: string;
  eventType: SocialConnectionEventType;
  message: string;
  metadata: SocialConnectionMetadata;
  createdAt: string;
}

// ── Provider-neutral adapter contract ───────────────────────────────────────
// Only adapters know provider endpoints, scopes, token shapes and
// verification logic. The service and UI are provider-agnostic.

export interface SocialAuthorizationRequestInput {
  workspaceId: string;
  userId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
  scopes: string[];
}

export interface SocialAuthorizationUrlResult {
  authorizationUrl: string;
}

export interface SocialTokenExchangeInput {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface SocialTokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  grantedScopes?: string[];
  externalAccountId: string;
  externalAccountLabel?: string;
  externalAccountType?: string;
  providerMetadata?: unknown;
}

export interface SocialRefreshInput {
  refreshToken: string;
}

export interface SocialRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  grantedScopes?: string[];
}

export interface SocialRevokeInput {
  accessToken?: string;
  refreshToken?: string;
}

export interface SocialRevokeResult {
  revoked: boolean;
}

export interface SocialVerifyResult {
  status: 'connected' | 'needs_reauth' | 'revoked' | 'failed';
  externalAccountLabel?: string;
  grantedScopes?: string[];
  safeWarning?: string;
  providerMetadata?: unknown;
}

export interface SocialConnectionProvider {
  readonly providerKey: string;
  readonly displayName: string;
  readonly supportsRefresh: boolean;
  readonly supportsDisconnectRevoke: boolean;
  /** Dev-only adapters must never masquerade as production platforms. */
  readonly devOnly: boolean;

  isConfigured(): Promise<boolean>;

  getAuthorizationUrl(
    input: SocialAuthorizationRequestInput,
  ): Promise<SocialAuthorizationUrlResult>;

  exchangeCode(input: SocialTokenExchangeInput): Promise<SocialTokenExchangeResult>;

  refreshToken(input: SocialRefreshInput): Promise<SocialRefreshResult>;

  revokeConnection(input: SocialRevokeInput): Promise<SocialRevokeResult>;

  verifyConnection(input: { accessToken: string }): Promise<SocialVerifyResult>;
}

/** Decrypted material — exists only inside the service boundary. */
export interface SocialTokenMaterial {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  grantedScopes?: string[];
}
