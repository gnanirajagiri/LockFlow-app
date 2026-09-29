/**
 * Social Connections UI helpers — labels, tones and safe summaries.
 * No provider-specific logic beyond display metadata.
 */
import type {
  SocialConnectionRecord,
  SocialConnectionStatus,
} from '../../domain/social';

export const CONNECTION_STATUS_LABELS: Record<SocialConnectionStatus, string> = {
  pending: 'Pending',
  connected: 'Connected',
  needs_reauth: 'Needs re-auth',
  revoked: 'Revoked',
  failed: 'Failed',
  disconnected: 'Disconnected',
};

export const CONNECTION_STATUS_TONES: Record<
  SocialConnectionStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  pending: 'neutral',
  connected: 'success',
  needs_reauth: 'warning',
  revoked: 'danger',
  failed: 'danger',
  disconnected: 'neutral',
};

/** Honest chip for a provider card, combining registry + config state. */
export function providerAvailability(
  provider: { status: string; configured: boolean },
): { tone: 'neutral' | 'success' | 'warning'; label: string; connectDisabled: boolean; unconfigured: boolean } {
  if (provider.status === 'dev_only') {
    return {
      tone: 'warning',
      label: 'Development only',
      connectDisabled: false,
      unconfigured: false,
    };
  }
  if (!provider.configured) {
    return { tone: 'neutral', label: 'Not configured', connectDisabled: true, unconfigured: true };
  }
  // Available but not connected (spec state 1 chip wording).
  return { tone: 'success', label: 'Not connected', connectDisabled: false, unconfigured: false };
}

export function formatVerifiedAt(iso: string | null): string {
  if (!iso) return 'Never verified';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Scope summary stays short and safe (scope names are not secret). */
export function summarizeScopes(scopes: string[] | null): string {
  if (!scopes || scopes.length === 0) return 'No scopes recorded';
  return scopes.join(', ');
}

export function connectionDisplayName(connection: SocialConnectionRecord): string {
  return connection.localName || connection.externalAccountLabel || 'Connected account';
}
