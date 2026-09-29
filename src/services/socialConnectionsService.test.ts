/**
 * Social Connections — the product contracts, tested at the service boundary
 * over fresh in-memory repositories.
 *
 * Covers the 14 required cases: workspace scoping, token secrecy, OAuth
 * state creation/validation/expiry/replay, encrypted storage + sanitized
 * metadata, disconnect/revocation, verification statuses, unconfigured
 * providers, dev-only honesty, secrets hygiene and adapter isolation.
 * (Case 11 — campaign channel preferences — is deferred with the publishing
 * task; the honest status integration in Campaigns is verified in the UI.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SocialConnectionsService } from './socialConnectionsService';
import { SocialConnectionEncryptionService } from './socialConnectionEncryption';
import {
  createDefaultProviderRegistry,
  DevFakeConnectionProvider,
  SocialConnectionProviderRegistry,
} from './socialProviders';
import { MockSocialConnectionsRepository } from '../data/mockSocialConnectionsRepository';
import type { SocialConnectionsRepository } from '../data/socialConnectionsRepository';
import {
  ALLOWED_REDIRECT_PATHS,
  canTransitionSocialConnection,
  mapSafeProviderError,
  redactSecrets,
  sanitizeConnectionMetadata,
  SOCIAL_CONNECTION_TRANSITIONS,
  validateOauthState,
} from '../domain/social';
import type { SocialConnectionProvider } from '../domain/social';

const WS = 'ws_demo';
const OTHER_WS = 'ws_other';
const USER = 'demo-user';

let repo: SocialConnectionsRepository;
let service: SocialConnectionsService;

beforeEach(() => {
  repo = new MockSocialConnectionsRepository();
  service = new SocialConnectionsService(
    repo,
    createDefaultProviderRegistry(),
    new SocialConnectionEncryptionService(),
  );
});

/** Drives the real dev-fake flow: start → simulated provider callback. */
async function connectDevFake(workspaceId = WS): Promise<string> {
  const started = await service.startConnection(
    { providerKey: 'dev_fake', workspaceId, userId: USER },
    USER,
  );
  const callbackUrl = new URL(started.authorizationUrl);
  const state = callbackUrl.searchParams.get('state')!;
  const connection = await service.completeConnection(
    { providerKey: 'dev_fake', workspaceId, plainStateToken: state, code: 'dev_auth_code' },
    USER,
  );
  return connection.id;
}

describe('case 1 — workspace scoping', () => {
  it('scopes connections and events to the workspace', async () => {
    const connectionId = await connectDevFake(WS);
    const mine = await service.listConnections(WS);
    expect(mine).toHaveLength(1);
    const theirs = await service.listConnections(OTHER_WS);
    expect(theirs).toHaveLength(0);
    const events = await service.listEvents(OTHER_WS);
    expect(events).toHaveLength(0);
    expect(await service.listEvents(WS)).toHaveLength(4);
    void connectionId;
  });

  it('refuses cross-workspace access to a connection', async () => {
    const connectionId = await connectDevFake(WS);
    await expect(service.getConnection(connectionId, OTHER_WS)).rejects.toThrow(
      /different workspace/i,
    );
    await expect(service.verifyConnection(connectionId, OTHER_WS, USER)).rejects.toThrow(
      /different workspace/i,
    );
    await expect(service.disconnectConnection(connectionId, OTHER_WS, USER)).rejects.toThrow(
      /different workspace/i,
    );
  });

  it('rejects OAuth states presented with the wrong workspace', async () => {
    const started = await service.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await expect(
      service.completeConnection(
        { providerKey: 'dev_fake', workspaceId: OTHER_WS, plainStateToken: state, code: 'x' },
        USER,
      ),
    ).rejects.toThrow(/needs to be tried again|expired/i);
  });
});

describe('case 2 — token secrecy', () => {
  it('never exposes token values through any service or repository surface', async () => {
    const connectionId = await connectDevFake();
    const connection = await service.getConnection(connectionId, WS);
    const serialized = JSON.stringify({ connection, events: await service.listEvents(WS) });
    expect(serialized).not.toMatch(/dev_fake_access_|dev_fake_refresh_/);

    const envelope = await repo.readTokenEnvelope(connectionId);
    expect(envelope?.accessTokenEncrypted).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(envelope?.accessTokenEncrypted).not.toContain('dev_fake_access_');

    const listing = JSON.stringify(await service.listConnections(WS));
    expect(listing).not.toMatch(/dev_fake_access_|dev_fake_refresh_/);
  });

  it('stores ciphertext that only the service key can decrypt', async () => {
    const connectionId = await connectDevFake();
    const envelope = await repo.readTokenEnvelope(connectionId);
    const stranger = new SocialConnectionEncryptionService('a-completely-different-key');
    await expect(stranger.decrypt(envelope!.accessTokenEncrypted)).rejects.toThrow();
    const owner = new SocialConnectionEncryptionService();
    const round = await owner.decrypt(envelope!.accessTokenEncrypted);
    expect(round).toMatch(/^dev_fake_access_/);
  });
});

describe('cases 3–5 — OAuth state lifecycle', () => {
  it('creates an expiring state with a hashed token and safe redirect', async () => {
    const started = await service.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    expect(started.redirectUri).toBe(
      'http://localhost:5173/settings/connections/callback/dev_fake',
    );
    expect(ALLOWED_REDIRECT_PATHS).toContain(
      new URL(started.redirectUri).pathname,
    );
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    // The stored record holds only the hash.
    const { sha256Hex } = await import('../domain/social');
    const stored = await repo.findOauthStateByHash(await sha256Hex(state));
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(state);
  });

  it('rejects replay after single-use consumption', async () => {
    const started = await service.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await service.completeConnection(
      { providerKey: 'dev_fake', workspaceId: WS, plainStateToken: state, code: 'one' },
      USER,
    );
    await expect(
      service.completeConnection(
        { providerKey: 'dev_fake', workspaceId: WS, plainStateToken: state, code: 'two' },
        USER,
      ),
    ).rejects.toThrow(/needs to be tried again/i);
  });

  it('rejects expired states with the safe expired message', async () => {
    const started = await service.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const { sha256Hex } = await import('../domain/social');
    const stored = await repo.findOauthStateByHash(await sha256Hex(state))!;
    const check = await validateOauthState(stored!, {
      providerKey: 'dev_fake',
      workspaceId: WS,
      plainStateToken: state,
      now: new Date(Date.now() + 11 * 60 * 1000),
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('expired');
  });

  it('purges only strictly-expired states; consumed states stay until expiry', async () => {
    await service.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    const soon = new Date(Date.now() + 60 * 1000).toISOString(); // not expired
    await repo.createOauthState({
      workspaceId: WS,
      providerKey: 'dev_fake',
      stateTokenHash: 'a'.repeat(64),
      redirectUri: 'http://localhost:5173/settings/connections/callback/dev_fake',
      expiresAt: soon,
      createdBy: USER,
    });
    const past = new Date(Date.now() - 60 * 1000).toISOString(); // expired
    await repo.createOauthState({
      workspaceId: WS,
      providerKey: 'dev_fake',
      stateTokenHash: 'b'.repeat(64),
      redirectUri: 'http://localhost:5173/settings/connections/callback/dev_fake',
      expiresAt: past,
      createdBy: USER,
    });
    const purged = await repo.purgeExpiredOauthStates(new Date().toISOString());
    expect(purged).toBe(1);
    expect(await repo.findOauthStateByHash('a'.repeat(64))).not.toBeNull();
    expect(await repo.findOauthStateByHash('b'.repeat(64))).toBeNull();
  });

  it('rejects mismatched provider or forged tokens', async () => {
    const started = await service.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await expect(
      service.completeConnection(
        { providerKey: 'meta', workspaceId: WS, plainStateToken: state, code: 'x' },
        USER,
      ),
    ).rejects.toThrow(/needs to be tried again|expired/i);
    await expect(
      service.completeConnection(
        { providerKey: 'dev_fake', workspaceId: WS, plainStateToken: 'f'.repeat(64), code: 'x' },
        USER,
      ),
    ).rejects.toThrow(/expired before completion/i);
  });
});

describe('case 6 — encrypted storage and sanitized metadata', () => {
  it('stores encrypted tokens and only safe, sanitized metadata', async () => {
    const connectionId = await connectDevFake();
    const connection = await service.getConnection(connectionId, WS);
    expect(connection.status).toBe('connected');
    expect(connection.externalAccountLabel).toBe('Demo Brand Account');
    expect(connection.grantedScopes).toEqual(['demo.basic', 'demo.insights']);
    expect(connection.connectionMetadata).toEqual({ simulated: true });
    const envelope = await repo.readTokenEnvelope(connectionId);
    expect(envelope?.refreshTokenEncrypted).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });
});

describe('cases 7 & 14 — disconnect and safe revocation failure', () => {
  it('disconnects: revokes, deletes tokens, marks disconnected, preserves events', async () => {
    const connectionId = await connectDevFake();
    await service.disconnectConnection(connectionId, WS, USER);
    const after = await service.getConnection(connectionId, WS);
    expect(after.status).toBe('disconnected');
    expect(after.disconnectedAt).not.toBeNull();
    expect(await repo.readTokenEnvelope(connectionId)).toBeNull();
    const types = (await service.listEvents(WS)).map((e) => e.eventType);
    expect(types).toContain('revoke_requested');
    expect(types).toContain('revoke_succeeded');
    expect(types).toContain('disconnected');
    // History preserved — no events deleted.
    expect((await service.listEvents(WS)).length).toBeGreaterThanOrEqual(7);
  });

  it('removes local credentials even when the provider revoke fails', async () => {
    // A provider whose revoke endpoint throws — local cleanup must still win.
    class BrokenRevokeProvider extends DevFakeConnectionProvider {
      override async revokeConnection(): Promise<{ revoked: boolean }> {
        throw new Error('revoke endpoint 500 — internal provider detail');
      }
    }
    const brokenRegistry = new SocialConnectionProviderRegistry(new BrokenRevokeProvider());
    const brokenService = new SocialConnectionsService(
      repo,
      brokenRegistry,
      new SocialConnectionEncryptionService(),
    );
    const started = await brokenService.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const connection = await brokenService.completeConnection(
      { providerKey: 'dev_fake', workspaceId: WS, plainStateToken: state, code: 'x' },
      USER,
    );
    await brokenService.disconnectConnection(connection.id, WS, USER);
    expect(await repo.readTokenEnvelope(connection.id)).toBeNull();
    const after = await brokenService.getConnection(connection.id, WS);
    expect(after.status).toBe('disconnected');
    const types = (await service.listEvents(WS)).map((e) => e.eventType);
    expect(types).toContain('revoke_failed');
    // The raw provider error text never lands anywhere readable.
    const everything = JSON.stringify(await service.listEvents(WS));
    expect(everything).not.toContain('revoke endpoint 500');
  });
});

describe('case 8 — verification statuses', () => {
  it('records passed verification with a timestamp', async () => {
    const connectionId = await connectDevFake();
    const verified = await service.verifyConnection(connectionId, WS, USER);
    expect(verified.status).toBe('connected');
    expect(verified.lastVerifiedAt).not.toBeNull();
  });

  it('maps invalid tokens to needs_reauth with a safe message', async () => {
    class StaleTokenProvider extends DevFakeConnectionProvider {
      override async verifyConnection(): Promise<{ status: 'needs_reauth'; safeWarning?: string }> {
        return { status: 'needs_reauth', safeWarning: 'Simulated session no longer valid.' };
      }
    }
    const staleService = new SocialConnectionsService(
      repo,
      new SocialConnectionProviderRegistry(new StaleTokenProvider()),
      new SocialConnectionEncryptionService(),
    );
    const started = await staleService.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const connection = await staleService.completeConnection(
      { providerKey: 'dev_fake', workspaceId: WS, plainStateToken: state, code: 'x' },
      USER,
    );
    const verified = await staleService.verifyConnection(connection.id, WS, USER);
    expect(verified.status).toBe('needs_reauth');
    expect(verified.lastErrorMessageSafe).toMatch(/no longer valid/i);
    expect(JSON.stringify(verified)).not.toMatch(/dev_fake_access_/);
  });
});

describe('cases 9 & 10 — unconfigured and dev-only providers', () => {
  it('refuses to start flows for unconfigured production providers', async () => {
    for (const key of ['meta', 'tiktok', 'youtube', 'linkedin']) {
      await expect(
        service.startConnection({ providerKey: key, workspaceId: WS, userId: USER }, USER),
      ).rejects.toThrow(/credentials are not configured/i);
    }
    const providers = await service.listProviders(WS);
    const meta = providers.find((p) => p.key === 'meta');
    expect(meta?.status).toBe('disabled');
    expect(meta?.configured).toBe(false);
  });

  it('marks the dev provider as dev-only and registry statuses stay honest', async () => {
    const provider = new DevFakeConnectionProvider();
    expect(provider.devOnly).toBe(true);
    const providers = await service.listProviders(WS);
    const fake = providers.find((p) => p.key === 'dev_fake');
    expect(fake?.status).toBe('dev_only');
    expect(fake?.configured).toBe(true);
  });

  it('exposes the transition machine including terminal disconnected', () => {
    expect(SOCIAL_CONNECTION_TRANSITIONS.disconnected).toEqual([]);
    expect(canTransitionSocialConnection('connected', 'needs_reauth')).toBe(true);
    expect(canTransitionSocialConnection('disconnected', 'connected')).toBe(false);
  });
});

describe('case 12 — secrets hygiene', () => {
  it('redacts secret-shaped values from metadata, text and provider errors', () => {
    const sanitized = sanitizeConnectionMetadata({
      accessToken: 'raw-secret-value',
      note: 'safe',
      nested: undefined,
    });
    expect(sanitized).toEqual({ accessToken: '[redacted]', note: 'safe' });
    expect(redactSecrets('access_token=abc123 and a verylongtokenvalue123456789012345678901234')).not.toContain('abc123');
    const safe = mapSafeProviderError(new Error('{"error":"invalid_grant","details":"x"}'));
    expect(safe).toEqual({
      code: 'grant_invalid',
      message: 'The provider authorization has expired or was revoked. Please reconnect.',
    });
    expect(safe.message).not.toContain('invalid_grant');
  });

  it('keeps raw provider failures out of events and thrown messages', async () => {
    class ExplodingExchangeProvider extends DevFakeConnectionProvider {
      override async exchangeCode(): Promise<never> {
        throw new Error('token endpoint returned HTTP 401 with inner_token=RAWSECRET123456789');
      }
    }
    const exploding = new SocialConnectionsService(
      repo,
      new SocialConnectionProviderRegistry(new ExplodingExchangeProvider()),
      new SocialConnectionEncryptionService(),
    );
    const started = await exploding.startConnection(
      { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
      USER,
    );
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    await expect(
      exploding.completeConnection(
        { providerKey: 'dev_fake', workspaceId: WS, plainStateToken: state, code: 'x' },
        USER,
      ),
    ).rejects.toThrow(/needs to be tried again/i);
    const all = JSON.stringify(await exploding.listEvents(WS));
    expect(all).not.toContain('RAWSECRET');
    expect(all).not.toContain('inner_token');
  });
});

describe('case 13 — provider isolation', () => {
  it('keeps provider-specific knowledge inside adapters (typed contract)', async () => {
    const registry = createDefaultProviderRegistry();
    for (const provider of registry.list()) {
      expect(typeof provider.isConfigured).toBe('function');
      expect(typeof provider.getAuthorizationUrl).toBe('function');
      expect(typeof provider.exchangeCode).toBe('function');
      expect(typeof provider.verifyConnection).toBe('function');
      expect(typeof (provider as SocialConnectionProvider).revokeConnection).toBe('function');
    }
  });
});
