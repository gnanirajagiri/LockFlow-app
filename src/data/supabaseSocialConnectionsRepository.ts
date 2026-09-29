/**
 * Supabase Social Connections adapter.
 *
 * Mapping notes:
 *   * `workspace_social_connection_tokens` has NO RLS policies (deny-all to
 *     client roles) — token reads/writes are only possible with the server
 *     service role. The methods here are typed for that server-side usage;
 *     the client build never calls them with user credentials.
 *   * All other tables follow the standard workspace-membership policies.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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

function camelizeConnection(row: Record<string, unknown>): SocialConnectionRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    providerKey: row.provider_key as string,
    localName: row.local_name as string,
    externalAccountIdHash: row.external_account_id_hash as string,
    externalAccountLabel: (row.external_account_label as string | null) ?? null,
    externalAccountType: (row.external_account_type as string | null) ?? null,
    status: row.status as SocialConnectionStatus,
    grantedScopes: (row.granted_scopes as string[] | null) ?? null,
    connectionMetadata: (row.connection_metadata as SocialConnectionMetadata) ?? null,
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    lastErrorMessageSafe: (row.last_error_message_safe as string | null) ?? null,
    connectedBy: row.connected_by as string,
    connectedAt: (row.connected_at as string | null) ?? null,
    disconnectedAt: (row.disconnected_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SupabaseSocialConnectionsRepository implements SocialConnectionsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listProviders(): Promise<SocialProviderRecord[]> {
    const { data, error } = await this.client
      .from('social_connection_providers')
      .select('*')
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map((row) => ({
      key: row.key,
      displayName: row.display_name,
      status: row.status,
      supportsRefresh: row.supports_refresh,
      supportsDisconnectRevoke: row.supports_disconnect_revoke,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getProvider(key: string): Promise<SocialProviderRecord | null> {
    const { data, error } = await this.client
      .from('social_connection_providers')
      .select('*')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      key: data.key,
      displayName: data.display_name,
      status: data.status,
      supportsRefresh: data.supports_refresh,
      supportsDisconnectRevoke: data.supports_disconnect_revoke,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async listConnections(workspaceId: string): Promise<SocialConnectionRecord[]> {
    const { data, error } = await this.client
      .from('workspace_social_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map(camelizeConnection);
  }

  async getConnection(connectionId: string): Promise<SocialConnectionRecord | null> {
    const { data, error } = await this.client
      .from('workspace_social_connections')
      .select('*')
      .eq('id', connectionId)
      .maybeSingle();
    if (error) throw error;
    return data ? camelizeConnection(data) : null;
  }

  async findActiveConnection(
    workspaceId: string,
    providerKey: string,
    externalAccountIdHash: string,
  ): Promise<SocialConnectionRecord | null> {
    const { data, error } = await this.client
      .from('workspace_social_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('provider_key', providerKey)
      .eq('external_account_id_hash', externalAccountIdHash)
      .neq('status', 'disconnected')
      .maybeSingle();
    if (error) throw error;
    return data ? camelizeConnection(data) : null;
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
    const { data, error } = await this.client
      .from('workspace_social_connections')
      .insert({
        workspace_id: input.workspaceId,
        provider_key: input.providerKey,
        local_name: input.localName,
        external_account_id_hash: input.externalAccountIdHash,
        external_account_label: input.externalAccountLabel ?? null,
        external_account_type: input.externalAccountType ?? null,
        status: input.status,
        granted_scopes: input.grantedScopes ?? null,
        connection_metadata: input.connectionMetadata ?? null,
        connected_by: input.connectedBy,
        connected_at: input.connectedAt ?? new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) throw error;
    return camelizeConnection(data);
  }

  async updateConnection(
    connectionId: string,
    patch: {
      localName?: string;
      status?: SocialConnectionStatus;
      grantedScopes?: string[] | null;
      externalAccountLabel?: string;
      externalAccountType?: string;
      connectionMetadata?: SocialConnectionMetadata;
      lastVerifiedAt?: string | null;
      lastErrorCode?: string | null;
      lastErrorMessageSafe?: string | null;
      connectedAt?: string | null;
      disconnectedAt?: string | null;
    },
  ): Promise<SocialConnectionRecord> {
    const { data, error } = await this.client
      .from('workspace_social_connections')
      .update({
        ...(patch.localName !== undefined ? { local_name: patch.localName } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.grantedScopes !== undefined ? { granted_scopes: patch.grantedScopes } : {}),
        ...(patch.externalAccountLabel !== undefined
          ? { external_account_label: patch.externalAccountLabel }
          : {}),
        ...(patch.externalAccountType !== undefined
          ? { external_account_type: patch.externalAccountType }
          : {}),
        ...(patch.connectionMetadata !== undefined
          ? { connection_metadata: patch.connectionMetadata }
          : {}),
        ...(patch.lastVerifiedAt !== undefined ? { last_verified_at: patch.lastVerifiedAt } : {}),
        ...(patch.lastErrorCode !== undefined ? { last_error_code: patch.lastErrorCode } : {}),
        ...(patch.lastErrorMessageSafe !== undefined
          ? { last_error_message_safe: patch.lastErrorMessageSafe }
          : {}),
        ...(patch.connectedAt !== undefined ? { connected_at: patch.connectedAt } : {}),
        ...(patch.disconnectedAt !== undefined ? { disconnected_at: patch.disconnectedAt } : {}),
      })
      .eq('id', connectionId)
      .select('*')
      .single();
    if (error) throw error;
    return camelizeConnection(data);
  }

  async saveToken(
    workspaceSocialConnectionId: string,
    envelope: SocialTokenEnvelope,
  ): Promise<SocialConnectionTokenRecord> {
    const { data, error } = await this.client
      .from('workspace_social_connection_tokens')
      .upsert(
        {
          workspace_social_connection_id: workspaceSocialConnectionId,
          access_token_encrypted: envelope.accessTokenEncrypted,
          refresh_token_encrypted: envelope.refreshTokenEncrypted ?? null,
          expires_at: envelope.expiresAt ?? null,
          token_metadata: envelope.tokenMetadata ?? null,
        },
        { onConflict: 'workspace_social_connection_id' },
      )
      .select('id, workspace_social_connection_id, expires_at, token_metadata, created_at, updated_at')
      .single();
    if (error) throw error;
    return {
      id: data.id,
      workspaceSocialConnectionId: data.workspace_social_connection_id,
      expiresAt: data.expires_at,
      tokenMetadata: data.token_metadata,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  async readTokenEnvelope(
    workspaceSocialConnectionId: string,
  ): Promise<(SocialTokenEnvelope & { id: string }) | null> {
    const { data, error } = await this.client
      .from('workspace_social_connection_tokens')
      .select(
        'id, workspace_social_connection_id, access_token_encrypted, refresh_token_encrypted, expires_at, token_metadata',
      )
      .eq('workspace_social_connection_id', workspaceSocialConnectionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      accessTokenEncrypted: data.access_token_encrypted,
      refreshTokenEncrypted: data.refresh_token_encrypted ?? undefined,
      expiresAt: data.expires_at ?? undefined,
      tokenMetadata: data.token_metadata ?? undefined,
    };
  }

  async deleteToken(workspaceSocialConnectionId: string): Promise<void> {
    const { error } = await this.client
      .from('workspace_social_connection_tokens')
      .delete()
      .eq('workspace_social_connection_id', workspaceSocialConnectionId);
    if (error) throw error;
  }

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
    const { data, error } = await this.client
      .from('social_connection_oauth_states')
      .insert({
        workspace_id: input.workspaceId,
        provider_key: input.providerKey,
        state_token_hash: input.stateTokenHash,
        pkce_verifier_encrypted: input.pkceVerifierEncrypted ?? null,
        requested_scopes: input.requestedScopes ?? null,
        redirect_uri: input.redirectUri,
        expires_at: input.expiresAt,
        created_by: input.createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return {
      id: data.id,
      workspaceId: data.workspace_id,
      providerKey: data.provider_key,
      stateTokenHash: data.state_token_hash,
      pkceVerifierEncrypted: data.pkce_verifier_encrypted ?? null,
      requestedScopes: data.requested_scopes,
      redirectUri: data.redirect_uri,
      expiresAt: data.expires_at,
      consumedAt: data.consumed_at,
      createdBy: data.created_by,
      createdAt: data.created_at,
    };
  }

  async findOauthStateByHash(stateTokenHash: string): Promise<SocialOauthStateRecord | null> {
    const { data, error } = await this.client
      .from('social_connection_oauth_states')
      .select('*')
      .eq('state_token_hash', stateTokenHash)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      workspaceId: data.workspace_id,
      providerKey: data.provider_key,
      stateTokenHash: data.state_token_hash,
      pkceVerifierEncrypted: data.pkce_verifier_encrypted ?? null,
      requestedScopes: data.requested_scopes,
      redirectUri: data.redirect_uri,
      expiresAt: data.expires_at,
      consumedAt: data.consumed_at,
      createdBy: data.created_by,
      createdAt: data.created_at,
    };
  }

  async markOauthStateConsumed(id: string): Promise<void> {
    const { error } = await this.client
      .from('social_connection_oauth_states')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async purgeExpiredOauthStates(nowIso: string): Promise<number> {
    const { data, error } = await this.client
      .from('social_connection_oauth_states')
      .delete()
      .lt('expires_at', nowIso)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  async appendEvent(input: {
    workspaceId: string;
    workspaceSocialConnectionId: string | null;
    actorId: string | null;
    providerKey: string;
    eventType: SocialConnectionEventType;
    message: string;
    metadata?: SocialConnectionMetadata;
  }): Promise<SocialConnectionEventRecord> {
    const { data, error } = await this.client
      .from('social_connection_events')
      .insert({
        workspace_id: input.workspaceId,
        workspace_social_connection_id: input.workspaceSocialConnectionId,
        actor_id: input.actorId,
        provider_key: input.providerKey,
        event_type: input.eventType,
        message: input.message.slice(0, 400),
        metadata: input.metadata ?? {},
      })
      .select('*')
      .single();
    if (error) throw error;
    return {
      id: data.id,
      workspaceId: data.workspace_id,
      workspaceSocialConnectionId: data.workspace_social_connection_id,
      actorId: data.actor_id,
      providerKey: data.provider_key,
      eventType: data.event_type,
      message: data.message,
      metadata: data.metadata ?? null,
      createdAt: data.created_at,
    };
  }

  async listEvents(
    workspaceId: string,
    options?: { connectionId?: string; limit?: number },
  ): Promise<SocialConnectionEventRecord[]> {
    let query = this.client
      .from('social_connection_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (options?.connectionId) {
      query = query.eq('workspace_social_connection_id', options.connectionId);
    }
    if (options?.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceSocialConnectionId: row.workspace_social_connection_id,
      actorId: row.actor_id,
      providerKey: row.provider_key,
      eventType: row.event_type,
      message: row.message,
      metadata: row.metadata ?? null,
      createdAt: row.created_at,
    }));
  }
}
