/**
 * Video error mapper — safe user-facing messages; protected technical detail
 * only in server-side audit fields. Secrets scrubbed defensively.
 */
export interface MappedVideoError {
  userMessage: string;
  errorCode: string;
  protectedDetail: string;
}

function scrub(detail: string): string {
  return detail
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=***');
}

export function mapVideoProviderError(error: unknown): MappedVideoError {
  if (error instanceof Error) {
    const detail = scrub(error.message);
    if (/quota|rate limit|429/i.test(detail)) {
      return { userMessage: 'The video provider rate limit was hit. Try again shortly.', errorCode: 'video_provider_rate_limited', protectedDetail: detail };
    }
    if (/401|unauthorized|forbidden|403/i.test(detail)) {
      return { userMessage: 'The video provider rejected the request (configuration).', errorCode: 'video_provider_auth', protectedDetail: detail };
    }
    if (/safety|moderation|blocked|policy/i.test(detail)) {
      return { userMessage: 'The provider blocked this clip on safety grounds.', errorCode: 'video_provider_safety_block', protectedDetail: detail };
    }
    if (/timeout|network|fetch/i.test(detail)) {
      return { userMessage: 'The video provider could not be reached. Retry is available.', errorCode: 'video_provider_unreachable', protectedDetail: detail };
    }
    return { userMessage: 'Video generation failed. Safe retry is available for failed jobs.', errorCode: 'video_provider_error', protectedDetail: detail };
  }
  return {
    userMessage: 'Video generation failed. Safe retry is available for failed jobs.',
    errorCode: 'video_provider_error',
    protectedDetail: String(error),
  };
}
