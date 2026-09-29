/**
 * In-memory Social Connections repository — mirrors the SQL contract from
 * 20260929100000_social_connections.sql: one active connection per
 * workspace/provider/external account, single current token row per
 * connection, hashed single-use OAuth states, append-only events. Demo mode
 * starts with registry rows only (no connected accounts).
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
import type { SocialConnectionsRepository, SocialTokenEnvelope } from './socialConnectionsRepository';

function now(): string {
  return new Date().toISOString();
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_dev_${Date.now().toString(36)}${seq.toString(36)}`;
}

const PROVIDER_SEED: SocialProviderRecord[] = [
  {
    key: 'meta',
    displayName: 'Meta (Instagram Business / Facebook Page)',
    status: 'disabled',
    supportsRefresh: true,
    supportsDisconnectRevoke: true,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  },
  {
    key: 'tiktok',
    displayName: 'TikTok',
    status: 'disabled',
    supportsRefresh: true,
    supportsDisconnectRevoke: true,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  },
  {
    key: 'youtube',
    displayName: 'YouTube',
    status: 'disabled',
    supportsRefresh: true,
    supportsDisconnectRevoke: true,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  },
  {
    key: 'linkedin',
    displayName: 'LinkedIn',
    status: 'disabled',
    supportsRefresh: true,
    supportsDisconnectRevoke: true,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  },
  {
    key: 'x',
    displayName: 'X',
    status: 'disabled',
    supportsRefresh: false,
    supportsDisconnectRevoke: true,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  },
  {
    key: 'pinterest',
    displayName: 'Pinterest',
    status: 'disabled',
    supportsRefresh: true,
    supportsDisconnectRevoke: true,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  },
  {
    key: 'dev_fake',
    displayName: 'Development fake provider',
    status: 'dev_only',
    supportsRefresh: true,
    supportsDisconnectRevoke: true,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  },
];

export class MockSocialConnectionsRepository implements SocialConnectionsRepository {
  private providers: SocialProviderRecord[];
  private connections: SocialConnectionRecord[];
  private tokens: Map<string, SocialTokenEnvelope & { id: string; createdAt: string; updatedAt: string }>;
  private oauthStates: SocialOauthStateRecord[];
  private events: SocialConnectionEventRecord[];

  constructor() {
    this.providers = PROVIDER_SEED.map((p) => ({ ...p }));
    this.connections = [];
    this.tokens = new Map();
    this.oauthStates = [];
    this.events = [];
  }

  // ── Providers ──────────────────────────────────────────────────────────────

  async listProviders(): Promise<SocialProviderRecord[]> {
    return this.providers.map((p) => ({ ...p }));
  }

  async getProvider(key: string): Promise<SocialProviderRecord | null> {
    const found = this.providers.find((p) => p.key === key);
    return found ? { ...found } : null;
  }

  // ── Connections ────────────────────────────────────────────────────────────

  async listConnections(workspaceId: string): Promise<SocialConnectionRecord[]> {
    return this.connections
      .filter((c) => c.workspaceId === workspaceId)
      .map((c) => ({ ...c }));
  }

  async getConnection(connectionId: string): Promise<SocialConnectionRecord | null> {
    const found = this.connections.find((c) => c.id === connectionId);
    return found ? { ...found } : null;
  }

  async findActiveConnection(
    workspaceId: string,
    providerKey: string,
    externalAccountIdHash: string,
  ): Promise<SocialConnectionRecord | null> {
    const found = this.connections.find(
      (c) =>
        c.workspaceId === workspaceId &&
        c.providerKey === providerKey &&
        c.externalAccountIdHash === externalAccountIdHash &&
        c.status !== 'disconnected',
    );
    return found ? { ...found } : null;
  }

  async createConnection(input: {
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
  }): Promise<SocialConnectionRecord> {
    const ts = now();
    const record: SocialConnectionRecord = {
      id: uid('sconn'),
      workspaceId: input.workspaceId,
      providerKey: input.providerKey,
      localName: input.localName,
      externalAccountIdHash: input.externalAccountIdHash,
      externalAccountLabel: input.externalAccountLabel ?? null,
      externalAccountType: input.externalAccountType ?? null,
      status: input.status,
      grantedScopes: input.grantedScopes ?? null,
      connectionMetadata: input.connectionMetadata ?? null,
      lastVerifiedAt: null,
      lastErrorCode: null,
      lastErrorMessageSafe: null,
      connectedBy: input.connectedBy,
      connectedAt: input.connectedAt ?? ts,
      disconnectedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.connections.push(record);
    return { ...record };
  }

  async updateConnection(
    connectionId: string,
    patch: Partial<SocialConnectionRecord> & {
      grantedScopes?: string[] | null;
      connectionMetadata?: SocialConnectionMetadata;
    },
  ): Promise<SocialConnectionRecord> {
    const idx = this.connections.findIndex((c) => c.id === connectionId);
    if (idx === -1) throw new Error('Connection not found.');
    const next: SocialConnectionRecord = {
      ...this.connections[idx],
      ...patch,
      updatedAt: now(),
    };
    this.connections[idx] = next;
    return { ...next };
  }

  // ── Tokens ─────────────────────────────────────────────────────────────────

  async saveToken(
    workspaceSocialConnectionId: string,
    envelope: SocialTokenEnvelope,
  ): Promise<SocialConnectionTokenRecord> {
    const ts = now();
    const record = {
      id: uid('stok'),
      workspaceSocialConnectionId,
      ...envelope,
      createdAt: ts,
      updatedAt: ts,
    };
    // One current token record per connection — replace on save.
    this.tokens.set(workspaceSocialConnectionId, record);
    const { accessTokenEncrypted: _a, refreshTokenEncrypted: _r, ...safe } = record;
    return { ...safe, tokenMetadata: envelope.tokenMetadata ?? null, expiresAt: envelope.expiresAt ?? null };
  }

  async readTokenEnvelope(
    workspaceSocialConnectionId: string,
  ): Promise<(SocialTokenEnvelope & { id: string }) | null> {
    const found = this.tokens.get(workspaceSocialConnectionId);
    return found ? { ...found } : null;
  }

  async deleteToken(workspaceSocialConnectionId: string): Promise<void> {
    this.tokens.delete(workspaceSocialConnectionId);
  }

  // ── OAuth states ───────────────────────────────────────────────────────────

  async createOauthState(input: {
    workspaceId: string;
    providerKey: string;
    stateTokenHash: string;
    pkceVerifierEncrypted?: string;
    requestedScopes?: string[];
    redirectUri: string;
    expiresAt: string;
    createdBy: string;
  }): Promise<SocialOauthStateRecord> {
    const record: SocialOauthStateRecord = {
      id: uid('sstate'),
      workspaceId: input.workspaceId,
      providerKey: input.providerKey,
      stateTokenHash: input.stateTokenHash,
      pkceVerifierEncrypted: input.pkceVerifierEncrypted ?? null,
      requestedScopes: input.requestedScopes ?? null,
      redirectUri: input.redirectUri,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdBy: input.createdBy,
      createdAt: now(),
    };
    this.oauthStates.push(record);
    return { ...record };
  }

  async findOauthStateByHash(stateTokenHash: string): Promise<SocialOauthStateRecord | null> {
    const found = this.oauthStates.find((s) => s.stateTokenHash === stateTokenHash);
    return found ? { ...found } : null;
  }

  async markOauthStateConsumed(id: string): Promise<void> {
    const found = this.oauthStates.find((s) => s.id === id);
    if (found) found.consumedAt = now();
  }

  async purgeExpiredOauthStates(nowIso: string): Promise<number> {
    const before = this.oauthStates.length;
    this.oauthStates = this.oauthStates.filter(
      (s) => new Date(s.expiresAt).getTime() > new Date(nowIso).getTime() || s.consumedAt === null === false,
    );
    return before - this.oauthStates.length;
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async appendEvent(input: {
    workspaceId: string;
    workspaceSocialConnectionId: string | null;
    actorId: string | null;
    providerKey: string;
    eventType: SocialConnectionEventType;
    message: string;
    metadata?: SocialConnectionMetadata;
  }): Promise<SocialConnectionEventRecord> {
    const record: SocialConnectionEventRecord = {
      id: uid('sevent'),
      workspaceId: input.workspaceId,
      workspaceSocialConnectionId: input.workspaceSocialConnectionId,
      actorId: input.actorId,
      providerKey: input.providerKey,
      eventType: input.eventType,
      message: input.message.slice(0, 400),
      metadata: input.metadata ?? null,
      createdAt: now(),
    };
    this.events.push(record);
    return { ...record };
  }

  async listEvents(
    workspaceId: string,
    options?: { connectionId?: string; limit?: number },
  ): Promise<SocialConnectionEventRecord[]> {
    const filtered = this.events
      .filter(
        (e) =>
          e.workspaceId === workspaceId &&
          (options?.connectionId ? e.workspaceSocialConnectionId === options.connectionId : true),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return (options?.limit ? filtered.slice(0, options.limit) : filtered).map((e) => ({
      ...e,
      metadata: e.metadata ? { ...e.metadata } : null,
    }));
  }
}
