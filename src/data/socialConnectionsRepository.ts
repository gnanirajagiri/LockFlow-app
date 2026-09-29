/**
 * Social Connections — repository contract.
 *
 * Security shape:
 *   * Connection/token records NEVER contain raw token values — the token
 *     repository deals in ciphertext envelopes and safe metadata only.
 *   * OAuth states are addressed by their SHA-256 hash; plain state tokens
 *     are never passed into or out of the repository.
 */
import type {
  SocialConnectionEventRecord,
  SocialConnectionEventType,
  SocialConnectionMetadata,
  SocialConnectionRecord,
  SocialConnectionStatus,
  SocialConnectionTokenRecord,
  SocialOauthStateRecord,
  SocialProviderRecord,
} from '../domain/social';

/** Encrypted token envelope — ciphertext only, never plaintext. */
export interface SocialTokenEnvelope {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  expiresAt?: string;
  tokenMetadata?: SocialConnectionMetadata;
}

export interface SocialConnectionsRepository {
  // Providers (registry)
  listProviders(): Promise<SocialProviderRecord[]>;
  getProvider(key: string): Promise<SocialProviderRecord | null>;

  // Connections (workspace-scoped)
  listConnections(workspaceId: string): Promise<SocialConnectionRecord[]>;
  getConnection(connectionId: string): Promise<SocialConnectionRecord | null>;
  findActiveConnection(
    workspaceId: string,
    providerKey: string,
    externalAccountIdHash: string,
  ): Promise<SocialConnectionRecord | null>;
  createConnection(input: {
    workspaceId: string;
    providerKey: string;
    localName: string;
    externalAccountIdHash: string;
    externalAccountLabel?: string;
    externalAccountType?: string;
    status: SocialConnectionStatus;
    grantedScopes?: string[];
    connectionMetadata?: SocialConnectionMetadata;
    connectedBy: string;
    connectedAt?: string;
  }): Promise<SocialConnectionRecord>;
  updateConnection(
    connectionId: string,
    patch: {
      localName?: string;
      status?: SocialConnectionStatus;
      grantedScopes?: string[] | null;
      externalAccountLabel?: string | null;
      externalAccountType?: string | null;
      connectionMetadata?: SocialConnectionMetadata;
      lastVerifiedAt?: string | null;
      lastErrorCode?: string | null;
      lastErrorMessageSafe?: string | null;
      connectedAt?: string | null;
      disconnectedAt?: string | null;
    },
  ): Promise<SocialConnectionRecord>;

  // Tokens (server-only vault; ciphertext envelopes in/out)
  saveToken(
    workspaceSocialConnectionId: string,
    envelope: SocialTokenEnvelope,
  ): Promise<SocialConnectionTokenRecord>;
  readTokenEnvelope(
    workspaceSocialConnectionId: string,
  ): Promise<(SocialTokenEnvelope & { id: string }) | null>;
  deleteToken(workspaceSocialConnectionId: string): Promise<void>;

  // OAuth states (hashed; single-use handled by the service)
  createOauthState(input: {
    workspaceId: string;
    providerKey: string;
    stateTokenHash: string;
    pkceVerifierEncrypted?: string;
    requestedScopes?: string[];
    redirectUri: string;
    expiresAt: string;
    createdBy: string;
  }): Promise<SocialOauthStateRecord>;
  findOauthStateByHash(stateTokenHash: string): Promise<SocialOauthStateRecord | null>;
  markOauthStateConsumed(id: string): Promise<void>;
  purgeExpiredOauthStates(now: string): Promise<number>;

  // Events (append-only)
  appendEvent(input: {
    workspaceId: string;
    workspaceSocialConnectionId: string | null;
    actorId: string | null;
    providerKey: string;
    eventType: SocialConnectionEventType;
    message: string;
    metadata?: SocialConnectionMetadata;
  }): Promise<SocialConnectionEventRecord>;
  listEvents(
    workspaceId: string,
    options?: { connectionId?: string; limit?: number },
  ): Promise<SocialConnectionEventRecord[]>;
}
