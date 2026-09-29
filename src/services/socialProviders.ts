/**
 * Social Connections — provider registry and adapters.
 *
 * Provider-neutral architecture: only adapters know provider endpoints,
 * scopes and token shapes. Phase 1 ships the dev fake adapter plus honest
 * unconfigured stubs for production platforms — a stub refuses to start a
 * flow rather than pretending to be live.
 *
 * Configuration seam (server-only env names, values never in the client):
 *   META_APP_ID / META_APP_SECRET
 *   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET
 *   SOCIAL_CONN_REDIRECT_BASE_URL
 */
import type {
  SocialAuthorizationRequestInput,
  SocialAuthorizationUrlResult,
  SocialConnectionProvider,
  SocialRefreshInput,
  SocialRefreshResult,
  SocialRevokeInput,
  SocialRevokeResult,
  SocialTokenExchangeInput,
  SocialTokenExchangeResult,
  SocialVerifyResult,
} from '../domain/social';
import { SocialConnectionStateError } from '../domain/social';

/**
 * Server-side configuration read. The Vite client bundle has no access to
 * server-only env vars; adapters read them through this seam (in a hosted
 * deployment this becomes the edge/server runtime).
 */
export interface SocialProviderConfig {
  readServerVar(name: string): string | undefined;
}

/** Demo/dev config source — no production secrets exist in the client. */
export const demoProviderConfig: SocialProviderConfig = {
  readServerVar: () => undefined,
};

/**
 * Shared behaviour for unconfigured production adapters: refuse to start a
 * real flow, surface as unconfigured, never fabricate accounts.
 */
abstract class UnconfiguredProvider implements SocialConnectionProvider {
  abstract readonly providerKey: string;
  abstract readonly displayName: string;
  readonly supportsRefresh = true;
  readonly supportsDisconnectRevoke = true;
  readonly devOnly = false;

  constructor(protected readonly config: SocialProviderConfig) {}

  protected abstract readonly appIdVar: string;
  protected abstract readonly appSecretVar: string;

  async isConfigured(): Promise<boolean> {
    return Boolean(
      this.config.readServerVar(this.appIdVar) && this.config.readServerVar(this.appSecretVar),
    );
  }

  protected assertConfigured(): void {
    if (!this.config.readServerVar(this.appIdVar) || !this.config.readServerVar(this.appSecretVar)) {
      throw new SocialConnectionStateError(
        'Provider credentials are not configured. Connection is unavailable.',
      );
    }
  }

  async getAuthorizationUrl(_input: SocialAuthorizationRequestInput): Promise<SocialAuthorizationUrlResult> {
    this.assertConfigured();
    // Real adapter implementations (added once app review approves scopes
    // and redirect URIs) build the provider authorize URL here.
    throw new SocialConnectionStateError(
      'Production connection for this provider is not enabled yet.',
    );
  }

  async exchangeCode(_input: SocialTokenExchangeInput): Promise<SocialTokenExchangeResult> {
    this.assertConfigured();
    throw new SocialConnectionStateError(
      'Production connection for this provider is not enabled yet.',
    );
  }

  async refreshToken(_input: SocialRefreshInput): Promise<SocialRefreshResult> {
    this.assertConfigured();
    throw new SocialConnectionStateError(
      'Production connection for this provider is not enabled yet.',
    );
  }

  async revokeConnection(_input: SocialRevokeInput): Promise<SocialRevokeResult> {
    this.assertConfigured();
    throw new SocialConnectionStateError(
      'Production connection for this provider is not enabled yet.',
    );
  }

  async verifyConnection(_input: { accessToken: string }): Promise<SocialVerifyResult> {
    this.assertConfigured();
    throw new SocialConnectionStateError(
      'Production connection for this provider is not enabled yet.',
    );
  }
}

export class MetaConnectionProvider extends UnconfiguredProvider {
  readonly providerKey = 'meta';
  readonly displayName = 'Meta (Instagram Business / Facebook Page)';
  protected readonly appIdVar = 'META_APP_ID';
  protected readonly appSecretVar = 'META_APP_SECRET';
  // OAuth 2.0; no PKCE — strict state + redirect allowlist instead.
}

export class TikTokConnectionProvider extends UnconfiguredProvider {
  readonly providerKey = 'tiktok';
  readonly displayName = 'TikTok';
  protected readonly appIdVar = 'TIKTOK_CLIENT_KEY';
  protected readonly appSecretVar = 'TIKTOK_CLIENT_SECRET';
  // OAuth 2.0 + PKCE.
}

export class YouTubeConnectionProvider extends UnconfiguredProvider {
  readonly providerKey = 'youtube';
  readonly displayName = 'YouTube';
  protected readonly appIdVar = 'GOOGLE_CLIENT_ID';
  protected readonly appSecretVar = 'GOOGLE_CLIENT_SECRET';
  // Google OAuth 2.0 + PKCE.
}

export class LinkedInConnectionProvider extends UnconfiguredProvider {
  readonly providerKey = 'linkedin';
  readonly displayName = 'LinkedIn';
  protected readonly appIdVar = 'LINKEDIN_CLIENT_ID';
  protected readonly appSecretVar = 'LINKEDIN_CLIENT_SECRET';
  // OAuth 2.0 + PKCE; scopes gated on LinkedIn product approval.
}

/**
 * Development fake provider — clearly labelled, simulates the full lifecycle
 * (connect → token → verify → disconnect/revoke) with fake encrypted token
 * payloads and a safe demo account label. Never presented as production.
 */
export class DevFakeConnectionProvider implements SocialConnectionProvider {
  readonly providerKey = 'dev_fake';
  readonly displayName = 'Development fake provider';
  readonly supportsRefresh = true;
  readonly supportsDisconnectRevoke = true;
  readonly devOnly = true;

  async isConfigured(): Promise<boolean> {
    return true; // Always "configured" — it is a dev simulation.
  }

  async getAuthorizationUrl(
    input: SocialAuthorizationRequestInput,
  ): Promise<SocialAuthorizationUrlResult> {
    // Simulates the provider consent screen as a local route.
    const url = new URL(input.redirectUri);
    url.searchParams.set('state', input.state);
    if (input.codeChallenge) url.searchParams.set('code_challenge', input.codeChallenge);
    return { authorizationUrl: url.toString() };
  }

  async exchangeCode(_input: SocialTokenExchangeInput): Promise<SocialTokenExchangeResult> {
    return {
      accessToken: `dev_fake_access_${randomSuffix()}`,
      refreshToken: `dev_fake_refresh_${randomSuffix()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      grantedScopes: ['demo.basic', 'demo.insights'],
      externalAccountId: 'demo-brand-account-001',
      externalAccountLabel: 'Demo Brand Account',
      externalAccountType: 'demo_workspace',
      providerMetadata: { simulated: true },
    };
  }

  async refreshToken(_input: SocialRefreshInput): Promise<SocialRefreshResult> {
    return {
      accessToken: `dev_fake_access_${randomSuffix()}`,
      refreshToken: `dev_fake_refresh_${randomSuffix()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      grantedScopes: ['demo.basic', 'demo.insights'],
    };
  }

  async revokeConnection(_input: SocialRevokeInput): Promise<SocialRevokeResult> {
    return { revoked: true };
  }

  async verifyConnection(_input: { accessToken: string }): Promise<SocialVerifyResult> {
    // Token shape is simulated; verification always reports healthy.
    if (!_input.accessToken.startsWith('dev_fake_access_')) {
      return { status: 'needs_reauth', safeWarning: 'Simulated session no longer valid.' };
    }
    return {
      status: 'connected',
      externalAccountLabel: 'Demo Brand Account',
      grantedScopes: ['demo.basic', 'demo.insights'],
      providerMetadata: { simulated: true },
    };
  }
}

function randomSuffix(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class SocialConnectionProviderRegistry {
  private readonly providers = new Map<string, SocialConnectionProvider>();

  constructor(...providers: SocialConnectionProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.providerKey)) {
        throw new Error(`Duplicate provider key: ${provider.providerKey}`);
      }
      this.providers.set(provider.providerKey, provider);
    }
  }

  get(providerKey: string): SocialConnectionProvider | null {
    return this.providers.get(providerKey) ?? null;
  }

  list(): SocialConnectionProvider[] {
    return [...this.providers.values()];
  }
}

/** Default Phase 1 registry (demo config — production stubs are unconfigured). */
export function createDefaultProviderRegistry(
  config: SocialProviderConfig = demoProviderConfig,
): SocialConnectionProviderRegistry {
  return new SocialConnectionProviderRegistry(
    new MetaConnectionProvider(config),
    new TikTokConnectionProvider(config),
    new YouTubeConnectionProvider(config),
    new LinkedInConnectionProvider(config),
    new DevFakeConnectionProvider(),
  );
}
