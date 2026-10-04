/**
 * OpenAI image generation provider (gpt-image-1) — the first REAL provider
 * adapter, plugging into the existing generation architecture (registry,
 * eligibility, quotas, audit and Gallery ingestion all unchanged).
 *
 * Key handling: the user supplies their own API key in Settings; it is stored
 * in THIS browser's localStorage and sent only in the Authorization header to
 * api.openai.com. It is never written to job records, audit rows, Gallery
 * metadata or any browser-visible payload — failures are mapped to safe
 * messages and key material never appears in error strings.
 *
 * The adapter mirrors the DevelopmentFakeImageProvider contract exactly:
 * submit returns a provider request id with status 'processing'; the
 * in-flight request resolves in the background and getImageGenerationStatus
 * reports completion with data-URI PNG results (same shape the fake provider
 * returns, so the existing ingestion path consumes them unchanged).
 */
import type {
  ImageGenerationProvider,
  ImageGenerationProviderStatus,
  ImageGenerationRequest,
  ImageGenerationStatusResult,
} from './types';

const API_KEY_STORAGE_KEY = 'maya.openai.apiKey';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const MODEL = 'gpt-image-1';

export function getOpenAiApiKey(): string {
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setOpenAiApiKey(key: string): void {
  try {
    if (key.trim() === '') {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
    }
  } catch {
    // Storage unavailable (private mode) — provider stays unconfigured.
  }
}

/** Maps a LockFlow aspect-ratio string onto a gpt-image-1 size. */
function sizeFor(aspectRatio: string | undefined): '1024x1024' | '1024x1536' | '1536x1024' {
  switch (aspectRatio) {
    case '9:16':
    case '4:5':
      return '1024x1536';
    case '16:9':
    case '3:2':
      return '1536x1024';
    default:
      return '1024x1024';
  }
}

interface PendingRun {
  request: ImageGenerationRequest;
  promise: Promise<ImageGenerationStatusResult>;
}

/** Safe, product-friendly failure messages — never echo the API key. */
function safeError(status: number): { code: string; message: string } {
  if (status === 401) return { code: 'auth_failed', message: 'OpenAI rejected the API key. Check it in Settings.' };
  if (status === 403) return { code: 'forbidden', message: 'This OpenAI key cannot use image generation.' };
  if (status === 429) return { code: 'rate_limited', message: 'OpenAI rate limit reached — try again shortly.' };
  if (status >= 500) return { code: 'provider_unavailable', message: 'OpenAI is temporarily unavailable — try again shortly.' };
  return { code: 'provider_error', message: 'The image request was not accepted. Try adjusting the prompt.' };
}

export class OpenAiImageProvider implements ImageGenerationProvider {
  readonly providerName = 'openai';
  private readonly pending = new Map<string, PendingRun>();
  private counter = 0;

  async isConfigured(): Promise<boolean> {
    return getOpenAiApiKey().trim() !== '';
  }

  async submitImageGeneration(
    input: ImageGenerationRequest,
  ): Promise<{ providerRequestId: string; status: ImageGenerationProviderStatus }> {
    const providerRequestId = `openai-${input.idempotencyKey}-${++this.counter}`;
    const pending: PendingRun = {
      request: input,
      promise: this.requestImages(input),
    };
    this.pending.set(providerRequestId, pending);
    // Swallow the rejection here: failures surface as a failed status on the
    // next poll (the generation service treats polls as the source of truth),
    // never as an unhandled promise.
    void pending.promise.catch(() => undefined);
    return { providerRequestId, status: 'processing' };
  }

  async getImageGenerationStatus(providerRequestId: string): Promise<ImageGenerationStatusResult> {
    const pending = this.pending.get(providerRequestId);
    if (!pending) {
      return { status: 'failed', errorCode: 'unknown_run', errorMessage: 'This generation request is no longer available.' };
    }
    const result = await pending.promise;
    if (result.status === 'completed' || result.status === 'failed') {
      this.pending.delete(providerRequestId); // terminal — drop the run
    }
    return result;
  }

  private async requestImages(input: ImageGenerationRequest): Promise<ImageGenerationStatusResult> {
    const apiKey = getOpenAiApiKey();
    if (apiKey.trim() === '') {
      return { status: 'failed', errorCode: 'not_configured', errorMessage: 'Add an OpenAI API key in Settings first.' };
    }
    try {
      const response = await fetch(OPENAI_IMAGES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          prompt: input.prompt,
          n: Math.max(1, Math.min(input.outputCount, 4)),
          size: sizeFor(input.aspectRatio),
        }),
      });
      if (!response.ok) {
        const safe = safeError(response.status);
        return { status: 'failed', errorCode: safe.code, errorMessage: safe.message };
      }
      const payload = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const results = (payload.data ?? [])
        .map((item) => {
          if (item.b64_json) {
            return { remoteUrlOrBytes: `data:image/png;base64,${item.b64_json}`, mimeType: 'image/png', width: 1024, height: 1024 };
          }
          if (item.url) {
            return { remoteUrlOrBytes: item.url, mimeType: 'image/png', width: 1024, height: 1024 };
          }
          return null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
      if (results.length === 0) {
        return { status: 'failed', errorCode: 'empty_response', errorMessage: 'OpenAI returned no images for this prompt.' };
      }
      return {
        status: 'completed',
        results,
        providerMetadata: { provider: 'openai', model: MODEL, real: true },
      };
    } catch (err) {
      return {
        status: 'failed',
        errorCode: 'network_error',
        errorMessage: err instanceof Error && err.message.includes('Failed to fetch')
          ? 'Could not reach OpenAI — check your connection.'
          : 'The image request failed. Try again shortly.',
      };
    }
  }
}
