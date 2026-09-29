/**
 * Social Connections service — the single entry point the UI uses.
 *
 * Security contracts enforced here:
 *   * Workspace scoping on every read/write; cross-workspace access throws.
 *   * Raw tokens exist ONLY inside this service boundary (SocialTokenMaterial).
 *     Repositories deal in ciphertext; UI/serializers never receive material.
 *   * OAuth state: plain token is returned once at flow start, only its hash
 *     is stored, states are single-use and expire; callbacks validate
 *     provider + workspace pairing before any exchange.
 *   * All provider failures are mapped through SafeProviderErrorMapper —
 *     raw provider errors never reach callers, events or the UI.
 *   * Events are append-only with audit-safe metadata (sanitized).
 *
 * Connection management only: no publishing, scheduling or platform media
 * container APIs exist on this service.
 */
import type {
  SocialConnectionEventRecord,
  SocialConnectionRecord,
  SocialConnectionStatus,
  SocialProviderRecord,
  SocialTokenMaterial,
} from '../domain/social';
import {
  assertNotDevOnlyMasquerade,
  assertSocialTransition,
  isAllowedRedirectUri,
  mapSafeProviderError,
  oauthStateExpiry,
  sanitizeConnectionMetadata,
  sha256Hex,
  validateLocalName,
  validateOauthState,
} from '../domain/social';
import type { SocialConnectionsRepository } from '../data/socialConnectionsRepository';
import { SocialConnectionEncryptionService } from './socialConnectionEncryption';
import type {
  SocialConnectionProviderRegistry,
} from './socialProviders';

/** Where the app lives — used to validate redirect URIs (demo: current origin). */
function currentOrigin(): string {
  if (typeof window !== 'undefined' && window.location) return window.location.origin;
  return 'http://localhost:5173';
}

export function isInWorkspace(recordWorkspaceId: string, activeWorkspaceId: string): void {
  if (recordWorkspaceId !== activeWorkspaceId) {
    throw new Error('This record belongs to a different workspace.');
  }
}

export class SocialConnectionsService {
  constructor(
    private readonly repo: SocialConnectionsRepository,
    private readonly registry: SocialConnectionProviderRegistry,
    private readonly encryption: SocialConnectionEncryptionService,
  ) {}

  // ── Providers ──────────────────────────────────────────────────────────────

  /** Registry metadata joined with live configuration state. */
  async listProviders(workspaceId: string): Promise<Array<SocialProviderRecord & { configured: boolean }>> {
    isInWorkspaceScope(workspaceId);
    const [registryRows, providers] = await Promise.all([
      this.repo.listProviders(),
      Promise.all(
        this.registry.list().map(async (p) => ({
          providerKey: p.providerKey,
          configured: await p.isConfigured(),
        })),
      ),
    ]);
    const configuredByKey = new Map(registryProviders(providers));
    return registryRows.map((row) => ({
      ...row,
      configured: configuredByKey.get(row.key) ?? false,
    }));
  }

  // ── Start connection flow ──────────────────────────────────────────────────

  /**
   * Starts an OAuth flow: creates a single-use expiring state (hash stored),
   * optionally a PKCE verifier (encrypted), and returns the provider
   * authorization URL. The plain state token exists only in this return
   * value and is handed to the provider — never persisted.
   */
  async startConnection(
    input: { providerKey: string; workspaceId: string; userId: string },
    actorId: string,
  ): Promise<{ authorizationUrl: string; redirectUri: string }> {
    isInWorkspaceScope(input.workspaceId);
    const provider = this.requireProvider(input.providerKey);
    assertNotDevOnlyMasquerade(provider, false);

    if (!(await provider.isConfigured())) {
      await this.repo.appendEvent({
        workspaceId: input.workspaceId,
        workspaceSocialConnectionId: null,
        actorId,
        providerKey: input.providerKey,
        eventType: 'provider_disabled',
        message: 'Connection attempt on an unconfigured provider.',
        metadata: null,
      });
      throw new Error('Provider credentials are not configured. Connection is unavailable.');
    }

    const redirectUri = `${currentOrigin()}/settings/connections/callback/${input.providerKey}`;
    if (!isAllowedRedirectUri(redirectUri, currentOrigin())) {
      throw new Error('Redirect URI is not allowed for this provider.');
    }

    const stateToken = this.encryption.newStateToken();
    const stateTokenHash = await sha256Hex(stateToken);
    // PKCE where the provider supports it: verifier encrypted at rest.
    const codeVerifier = `${this.encryption.newStateToken()}`;
    const codeChallenge = await sha256Hex(codeVerifier);
    const pkceVerifierEncrypted = await this.encryption.encryptVerifier(codeVerifier);

    const state = await this.repo.createOauthState({
      workspaceId: input.workspaceId,
      providerKey: input.providerKey,
      stateTokenHash,
      pkceVerifierEncrypted,
      requestedScopes: defaultScopesFor(input.providerKey),
      redirectUri,
      expiresAt: oauthStateExpiry(),
      createdBy: actorId,
    });

    await this.repo.appendEvent({
      workspaceId: input.workspaceId,
      workspaceSocialConnectionId: null,
      actorId,
      providerKey: input.providerKey,
      eventType: 'connect_started',
      message: `Connection started for ${input.providerKey}.`,
      metadata: { stateId: state.id },
    });

    const { authorizationUrl } = await provider.getAuthorizationUrl({
      workspaceId: input.workspaceId,
      userId: input.userId,
      redirectUri,
      state: stateToken,
      codeChallenge,
      scopes: defaultScopesFor(input.providerKey),
    });
    return { authorizationUrl, redirectUri };
  }

  // ── Callback completion ────────────────────────────────────────────────────

  /**
   * Completes a connection from an OAuth callback. Validates state (single
   * use, unexpired, provider/workspace pairing), exchanges the code,
   * stores encrypted tokens, creates/updates the connection record and
   * verifies it. Returns the connection id; callers redirect with a safe
   * toast. Throws safe, redacted errors only.
   */
  async completeConnection(
    input: {
      providerKey: string;
      workspaceId: string;
      plainStateToken: string;
      code: string;
    },
    actorId: string,
  ): Promise<SocialConnectionRecord> {
    isInWorkspaceScope(input.workspaceId);
    const provider = this.requireProvider(input.providerKey);

    const stateHash = await sha256Hex(input.plainStateToken);
    const stored = await this.repo.findOauthStateByHash(stateHash);
    if (!stored) {
      throw new Error('Connection expired before completion. Please try again.');
    }
    const check = await validateOauthState(stored, {
      providerKey: input.providerKey,
      workspaceId: input.workspaceId,
      plainStateToken: input.plainStateToken,
    });
    if (!check.ok) {
      // Consume replayed/expired states so they cannot be retried.
      await this.repo.markOauthStateConsumed(stored.id);
      if (check.reason === 'expired') {
        throw new Error('Connection expired before completion. Please try again.');
      }
      throw new Error('This provider connection needs to be tried again.');
    }
    // Single-use: consume before any exchange work.
    await this.repo.markOauthStateConsumed(stored.id);

    await this.repo.appendEvent({
      workspaceId: input.workspaceId,
      workspaceSocialConnectionId: null,
      actorId,
      providerKey: input.providerKey,
      eventType: 'callback_received',
      message: 'Authorization callback received.',
      metadata: null,
    });

    let codeVerifier: string | undefined;
    if (stored.pkceVerifierEncrypted) {
      codeVerifier = await this.encryption.decryptVerifier(stored.pkceVerifierEncrypted);
    }

    // Server-side exchange — never in the browser.
    let exchange;
    try {
      exchange = await provider.exchangeCode({
        code: input.code,
        redirectUri: stored.redirectUri,
        codeVerifier,
      });
    } catch (raw) {
      const safe = mapSafeProviderError(raw);
      await this.repo.appendEvent({
        workspaceId: input.workspaceId,
        workspaceSocialConnectionId: null,
        actorId,
        providerKey: input.providerKey,
        eventType: 'verification_failed',
        message: safe.message,
        metadata: { code: safe.code },
      });
      throw new Error(safe.message);
    }

    const externalAccountIdHash = await sha256Hex(exchange.externalAccountId);
    const existing = await this.repo.findActiveConnection(
      input.workspaceId,
      input.providerKey,
      externalAccountIdHash,
    );

    const material: SocialTokenMaterial = {
      accessToken: exchange.accessToken,
      refreshToken: exchange.refreshToken,
      expiresAt: exchange.expiresAt,
      grantedScopes: exchange.grantedScopes,
    };
    const envelope = {
      accessTokenEncrypted: await this.encryption.encrypt(material.accessToken),
      refreshTokenEncrypted: material.refreshToken
        ? await this.encryption.encrypt(material.refreshToken)
        : undefined,
      expiresAt: material.expiresAt,
      tokenMetadata: sanitizeConnectionMetadata({ simulated: provider.devOnly }),
    };

    let connection: SocialConnectionRecord;
    if (existing) {
      connection = await this.repo.updateConnection(existing.id, {
        status: 'connected',
        grantedScopes: material.grantedScopes ?? null,
        externalAccountLabel: exchange.externalAccountLabel ?? existing.externalAccountLabel,
        externalAccountType: exchange.externalAccountType ?? existing.externalAccountType,
        lastErrorCode: null,
        lastErrorMessageSafe: null,
        disconnectedAt: null,
        connectedAt: new Date().toISOString(),
      });
      await this.repo.saveToken(existing.id, envelope);
    } else {
      connection = await this.repo.createConnection({
        workspaceId: input.workspaceId,
        providerKey: input.providerKey,
        localName: exchange.externalAccountLabel ?? provider.displayName,
        externalAccountIdHash,
        externalAccountLabel: exchange.externalAccountLabel,
        externalAccountType: exchange.externalAccountType,
        status: 'connected',
        grantedScopes: material.grantedScopes,
        connectionMetadata: sanitizeConnectionMetadata({ simulated: provider.devOnly }),
        connectedBy: actorId,
      });
      await this.repo.saveToken(connection.id, envelope);
    }

    await this.repo.appendEvent({
      workspaceId: input.workspaceId,
      workspaceSocialConnectionId: connection.id,
      actorId,
      providerKey: input.providerKey,
      eventType: 'connected',
      message: `Account connected: ${connection.localName}.`,
      metadata: sanitizeConnectionMetadata({ simulated: provider.devOnly }),
    });

    // Post-connect verification records health honestly.
    try {
      const verified = await provider.verifyConnection({ accessToken: material.accessToken });
      if (verified.status === 'connected') {
        await this.repo.updateConnection(connection.id, {
          status: 'connected',
          lastVerifiedAt: new Date().toISOString(),
        });
        await this.repo.appendEvent({
          workspaceId: input.workspaceId,
          workspaceSocialConnectionId: connection.id,
          actorId,
          providerKey: input.providerKey,
          eventType: 'verification_passed',
          message: 'Connection verified.',
          metadata: null,
        });
      } else {
        await this.applyVerificationFailure(connection, actorId, verified.status, verified.safeWarning);
      }
    } catch (raw) {
      const safe = mapSafeProviderError(raw);
      await this.applyVerificationFailure(connection, actorId, 'failed', safe.message, safe.code);
    }

    const fresh = await this.repo.getConnection(connection.id);
    if (!fresh) throw new Error('Connection record disappeared after connect.');
    return fresh;
  }

  // ── Verification / refresh ────────────────────────────────────────────────

  /** On-demand health check using the stored (decrypted in-memory) token. */
  async verifyConnection(
    connectionId: string,
    activeWorkspaceId: string,
    actorId: string,
  ): Promise<SocialConnectionRecord> {
    const connection = await this.getScopedConnection(connectionId, activeWorkspaceId);
    const provider = this.requireProvider(connection.providerKey);
    const material = await this.loadTokenMaterial(connection.id);

    try {
      const result = await provider.verifyConnection({ accessToken: material.accessToken });
      if (result.status === 'connected') {
        await this.repo.updateConnection(connection.id, {
          status: 'connected',
          lastVerifiedAt: new Date().toISOString(),
          lastErrorCode: null,
          lastErrorMessageSafe: null,
          ...(result.externalAccountLabel ? { externalAccountLabel: result.externalAccountLabel } : {}),
          ...(result.grantedScopes ? { grantedScopes: result.grantedScopes } : {}),
        });
        await this.repo.appendEvent({
          workspaceId: connection.workspaceId,
          workspaceSocialConnectionId: connection.id,
          actorId,
          providerKey: connection.providerKey,
          eventType: 'verification_passed',
          message: 'Connection verified.',
          metadata: null,
        });
      } else {
        await this.applyVerificationFailure(connection, actorId, result.status, result.safeWarning);
      }
    } catch (raw) {
      const safe = mapSafeProviderError(raw);
      await this.applyVerificationFailure(connection, actorId, 'failed', safe.message, safe.code);
    }
    return (await this.repo.getConnection(connection.id))!;
  }

  /** Refreshes the access token when the provider supports it. */
  async refreshConnection(
    connectionId: string,
    activeWorkspaceId: string,
    actorId: string,
  ): Promise<SocialConnectionRecord> {
    const connection = await this.getScopedConnection(connectionId, activeWorkspaceId);
    const provider = this.requireProvider(connection.providerKey);
    if (!provider.supportsRefresh) {
      throw new Error('This provider does not support token refresh.');
    }
    const material = await this.loadTokenMaterial(connection.id);
    if (!material.refreshToken) {
      throw new Error('No refresh token is stored for this connection.');
    }
    try {
      const refreshed = await provider.refreshToken({ refreshToken: material.refreshToken });
      await this.repo.saveToken(connection.id, {
        accessTokenEncrypted: await this.encryption.encrypt(refreshed.accessToken),
        refreshTokenEncrypted: refreshed.refreshToken
          ? await this.encryption.encrypt(refreshed.refreshToken)
          : undefined,
        expiresAt: refreshed.expiresAt,
        tokenMetadata: sanitizeConnectionMetadata({ rotatedAt: new Date().toISOString() }),
      });
      await this.repo.updateConnection(connection.id, {
        status: 'connected',
        lastVerifiedAt: new Date().toISOString(),
        lastErrorCode: null,
        lastErrorMessageSafe: null,
      });
      await this.repo.appendEvent({
        workspaceId: connection.workspaceId,
        workspaceSocialConnectionId: connection.id,
        actorId,
        providerKey: connection.providerKey,
        eventType: 'refreshed',
        message: 'Connection token refreshed.',
        metadata: null,
      });
    } catch (raw) {
      const safe = mapSafeProviderError(raw);
      await this.applyVerificationFailure(connection, actorId, 'failed', safe.message, safe.code);
    }
    return (await this.repo.getConnection(connection.id))!;
  }

  // ── Rename / disconnect ───────────────────────────────────────────────────

  async renameConnection(
    connectionId: string,
    localName: string,
    activeWorkspaceId: string,
    actorId: string,
  ): Promise<SocialConnectionRecord> {
    void actorId;
    const connection = await this.getScopedConnection(connectionId, activeWorkspaceId);
    const result = validateLocalName(localName);
    if (!result.ok) throw new Error(result.errors.join('; '));
    return this.repo.updateConnection(connection.id, { localName: result.value });
  }

  /**
   * Disconnect: revoke when the provider supports it, always invalidate the
   * local token, mark disconnected, preserve audit history. Revocation
   * failure never leaves the local credential active.
   */
  async disconnectConnection(
    connectionId: string,
    activeWorkspaceId: string,
    actorId: string,
  ): Promise<SocialConnectionRecord> {
    const connection = await this.getScopedConnection(connectionId, activeWorkspaceId);
    const provider = this.requireProvider(connection.providerKey);
    await this.repo.appendEvent({
      workspaceId: connection.workspaceId,
      workspaceSocialConnectionId: connection.id,
      actorId,
      providerKey: connection.providerKey,
      eventType: 'revoke_requested',
      message: 'Disconnect requested.',
      metadata: null,
    });

    let material: SocialTokenMaterial | null = null;
    try {
      material = await this.loadTokenMaterial(connection.id);
    } catch {
      material = null; // Token already gone — still mark disconnected.
    }

    if (provider.supportsDisconnectRevoke && material) {
      try {
        const result = await provider.revokeConnection({
          accessToken: material.accessToken,
          refreshToken: material.refreshToken,
        });
        await this.repo.appendEvent({
          workspaceId: connection.workspaceId,
          workspaceSocialConnectionId: connection.id,
          actorId,
          providerKey: connection.providerKey,
          eventType: result.revoked ? 'revoke_succeeded' : 'revoke_failed',
          message: result.revoked
            ? 'Provider authorization revoked.'
            : 'Provider revoke could not be confirmed; local credentials were removed.',
          metadata: null,
        });
      } catch (raw) {
        const safe = mapSafeProviderError(raw);
        await this.repo.appendEvent({
          workspaceId: connection.workspaceId,
          workspaceSocialConnectionId: connection.id,
          actorId,
          providerKey: connection.providerKey,
          eventType: 'revoke_failed',
          message: 'Provider revoke could not be confirmed; local credentials were removed.',
          metadata: { code: safe.code },
        });
      }
    }

    // Always invalidate local tokens — even when remote revoke failed.
    await this.repo.deleteToken(connection.id);
    assertSocialTransition(connection.status, 'disconnected');
    const updated = await this.repo.updateConnection(connection.id, {
      status: 'disconnected',
      disconnectedAt: new Date().toISOString(),
    });
    await this.repo.appendEvent({
      workspaceId: connection.workspaceId,
      workspaceSocialConnectionId: connection.id,
      actorId,
      providerKey: connection.providerKey,
      eventType: 'disconnected',
      message: 'Account disconnected.',
      metadata: null,
    });
    return updated;
  }

  // ── Listing / events ───────────────────────────────────────────────────────

  async listConnections(
    activeWorkspaceId: string,
  ): Promise<SocialConnectionRecord[]> {
    isInWorkspaceScope(activeWorkspaceId);
    return this.repo.listConnections(activeWorkspaceId);
  }

  async getConnection(
    connectionId: string,
    activeWorkspaceId: string,
  ): Promise<SocialConnectionRecord> {
    return this.getScopedConnection(connectionId, activeWorkspaceId);
  }

  async listEvents(
    activeWorkspaceId: string,
    options?: { connectionId?: string; limit?: number },
  ): Promise<SocialConnectionEventRecord[]> {
    isInWorkspaceScope(activeWorkspaceId);
    return this.repo.listEvents(activeWorkspaceId, options);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private requireProvider(providerKey: string) {
    const provider = this.registry.get(providerKey);
    if (!provider) {
      throw new Error('Unknown provider.');
    }
    return provider;
  }

  private async getScopedConnection(
    connectionId: string,
    activeWorkspaceId: string,
  ): Promise<SocialConnectionRecord> {
    const connection = await this.repo.getConnection(connectionId);
    if (!connection) throw new Error('Connection not found.');
    isInWorkspace(connection.workspaceId, activeWorkspaceId);
    return connection;
  }

  /**
   * Loads and decrypts token material strictly inside the service boundary.
   * This is the ONLY place ciphertext becomes plaintext.
   */
  private async loadTokenMaterial(connectionId: string): Promise<SocialTokenMaterial> {
    const envelope = await this.repo.readTokenEnvelope(connectionId);
    if (!envelope) throw new Error('No token stored for this connection.');
    const accessToken = await this.encryption.decrypt(envelope.accessTokenEncrypted);
    const refreshToken = envelope.refreshTokenEncrypted
      ? await this.encryption.decrypt(envelope.refreshTokenEncrypted)
      : undefined;
    return {
      accessToken,
      refreshToken,
      expiresAt: envelope.expiresAt,
    };
  }

  private async applyVerificationFailure(
    connection: SocialConnectionRecord,
    actorId: string,
    status: 'needs_reauth' | 'revoked' | 'failed',
    safeWarning?: string,
    errorCode?: string,
  ): Promise<void> {
    if (canReach(connection.status, status)) {
      await this.repo.updateConnection(connection.id, {
        status,
        lastErrorCode: errorCode ?? null,
        lastErrorMessageSafe: safeWarning ?? 'Connection verification failed. Please try again.',
      });
    } else {
      await this.repo.updateConnection(connection.id, {
        lastErrorCode: errorCode ?? null,
        lastErrorMessageSafe: safeWarning ?? 'Connection verification failed. Please try again.',
      });
    }
    await this.repo.appendEvent({
      workspaceId: connection.workspaceId,
      workspaceSocialConnectionId: connection.id,
      actorId,
      providerKey: connection.providerKey,
      eventType: status === 'needs_reauth' ? 'reauth_required' : 'verification_failed',
      message: safeWarning ?? 'Connection verification failed. Please try again.',
      metadata: errorCode ? { code: errorCode } : null,
    });
  }

}

/** A connection can only reach these statuses from non-terminal states. */
function canReach(from: SocialConnectionStatus, to: SocialConnectionStatus): boolean {
  const reachable: Record<string, SocialConnectionStatus[]> = {
    pending: ['connected', 'failed', 'disconnected'],
    connected: ['needs_reauth', 'revoked', 'failed', 'disconnected'],
    needs_reauth: ['connected', 'revoked', 'failed', 'disconnected'],
    failed: ['connected', 'disconnected'],
    revoked: ['disconnected'],
    disconnected: [],
  };
  return reachable[from]?.includes(to) ?? false;
}

function isInWorkspaceScope(workspaceId: string): void {
  if (!workspaceId) throw new Error('A workspace context is required.');
}

function registryProviders(
  entries: Array<{ providerKey: string; configured: boolean }>,
): Array<[string, boolean]> {
  return entries.map((e) => [e.providerKey, e.configured]);
}

/** Phase 1 default scope sets — documented, minimal, dev-fake friendly. */
function defaultScopesFor(providerKey: string): string[] {
  switch (providerKey) {
    case 'meta':
      return ['instagram_basic', 'pages_show_list', 'business_management'];
    case 'tiktok':
      return ['user.info.basic', 'video.list'];
    case 'youtube':
      return ['youtube.readonly'];
    case 'linkedin':
      return ['r_member_social', 'w_member_social'];
    case 'dev_fake':
      return ['demo.basic', 'demo.insights'];
    default:
      return [];
  }
}
