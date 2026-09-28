/**
 * DevelopmentFakeImageProvider — local development + automated tests only.
 *
 * Contract-faithful: implements the same adapter interface, transitions
 * (submitted → processing → completed), idempotency and result shapes as a
 * real adapter, but never performs a network call and produces clearly marked
 * placeholder outputs (an SVG data URL — no copyrighted imagery, no real
 * provider call is ever simulated). Production never selects this adapter.
 */
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationStatusResult,
} from './types';

interface FakeRun {
  request: ImageGenerationRequest;
  status: ImageGenerationStatusResult['status'];
  startedAt: number;
  results: ImageGenerationStatusResult['results'];
}

function placeholderSvg(jobId: string, index: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">` +
    `<rect width="100%" height="100%" fill="#e9e4dc"/>` +
    `<text x="50%" y="46%" font-family="monospace" font-size="20" fill="#5a544b" text-anchor="middle">` +
    `DEVELOPMENT PLACEHOLDER</text>` +
    `<text x="50%" y="56%" font-family="monospace" font-size="14" fill="#5a544b" text-anchor="middle">` +
    `${jobId} · ${index + 1}</text></svg>`;
  // Data URL keeps this fully offline; ingestion validates + stores it like
  // any other provider result.
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export class DevelopmentFakeImageProvider implements ImageGenerationProvider {
  readonly providerName = 'development-fake';

  private runs = new Map<string, FakeRun>();
  private counter = 0;

  async isConfigured(): Promise<boolean> {
    // The fake provider is always "configured" — it exists precisely so the
    // full submission/ingestion path is exercisable without credentials.
    return true;
  }

  async submitImageGeneration(
    input: ImageGenerationRequest,
  ): Promise<{ providerRequestId: string; status: ImageGenerationStatusResult['status'] }> {
    const providerRequestId = `fake-${input.idempotencyKey}-${++this.counter}`;
    this.runs.set(providerRequestId, {
      request: input,
      status: 'processing',
      startedAt: Date.now(),
      results: Array.from({ length: input.outputCount }, (_, index) => ({
        remoteUrlOrBytes: placeholderSvg(input.metadata.lockflowJobId, index),
        mimeType: 'image/svg+xml',
        width: 512,
        height: 512,
      })),
    });
    return { providerRequestId, status: 'processing' };
  }

  async getImageGenerationStatus(providerRequestId: string): Promise<ImageGenerationStatusResult> {
    const run = this.runs.get(providerRequestId);
    if (!run) {
      return { status: 'failed', errorCode: 'unknown_run', errorMessage: 'Unknown fake provider request id.' };
    }
    // Complete deterministically on the first poll — no timers, no flake.
    run.status = 'completed';
    return {
      status: 'completed',
      results: run.results,
      providerMetadata: { fake: true, placeholder: true },
    };
  }
}
