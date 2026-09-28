/**
 * Provider error mapper — rule: users see safe, actionable messages; full
 * technical detail is preserved only for protected server-side audit fields.
 * Provider API keys never appear anywhere (they are never part of error
 * objects passed through here, and messages are scrubbed defensively).
 */
export interface MappedProviderError {
  /** Safe for UI display. */
  userMessage: string;
  /** Stable machine code for logs/audit. */
  errorCode: string;
  /** Full technical detail — server logs / audit metadata only. */
  protectedDetail: string;
}

function scrubSecrets(detail: string): string {
  return detail
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=***');
}

export function mapProviderError(error: unknown): MappedProviderError {
  if (error instanceof Error) {
    const detail = scrubSecrets(error.message);
    if (/quota|rate limit|429/i.test(detail)) {
      return { userMessage: 'The provider rate limit was hit. Try again shortly.', errorCode: 'provider_rate_limited', protectedDetail: detail };
    }
    if (/401|unauthorized|forbidden|403/i.test(detail)) {
      return { userMessage: 'The generation provider rejected the request (configuration).', errorCode: 'provider_auth', protectedDetail: detail };
    }
    if (/safety|moderation|blocked|policy/i.test(detail)) {
      return { userMessage: 'The provider blocked this request on safety grounds.', errorCode: 'provider_safety_block', protectedDetail: detail };
    }
    if (/timeout|network|fetch/i.test(detail)) {
      return { userMessage: 'The generation provider could not be reached. Retry is available.', errorCode: 'provider_unreachable', protectedDetail: detail };
    }
    return { userMessage: 'Generation failed. Safe retry is available for failed jobs.', errorCode: 'provider_error', protectedDetail: detail };
  }
  return {
    userMessage: 'Generation failed. Safe retry is available for failed jobs.',
    errorCode: 'provider_error',
    protectedDetail: String(error),
  };
}
