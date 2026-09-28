/**
 * DevelopmentFakeVideoProvider — local development + automated tests only.
 *
 * Same contract/lifecycle as a real adapter (submitted → processing →
 * completed with ingestion-ready results) but zero network calls and clearly
 * labelled placeholder results: the fake returns data-URL placeholders whose
 * metadata is explicitly marked, so ingestion stores them through the exact
 * production path. Production never selects this adapter.
 */
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationStatusResult,
  VideoGenerationResult,
} from './videoTypes';

interface FakeVideoRun {
  request: VideoGenerationRequest;
  status: VideoGenerationStatusResult['status'];
  results: VideoGenerationResult[];
}

function placeholderVideoDataUrl(jobId: string, index: number): string {
  // A minimal, valid WebM/EBML header followed by a marker payload. It is a
  // development placeholder (never a real generated clip) and is stored like
  // any provider result through the normal ingestion path.
  const ebmlHeader = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x10, 0x42, 0x82, 0x69, 0x77, 0x65, 0x62, 0x6d,
  ]);
  const marker = new TextEncoder().encode(`lockflow-dev-placeholder:${jobId}:${index + 1}`);
  const bytes = new Uint8Array(ebmlHeader.length + marker.length);
  bytes.set(ebmlHeader, 0);
  bytes.set(marker, ebmlHeader.length);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:video/webm;base64,${btoa(binary)}`;
}

function placeholderThumbnailDataUrl(jobId: string, index: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">` +
    `<rect width="100%" height="100%" fill="#2e2a25"/>` +
    `<text x="50%" y="48%" font-family="monospace" font-size="16" fill="#e9e4dc" text-anchor="middle">` +
    `DEV VIDEO PLACEHOLDER</text>` +
    `<text x="50%" y="60%" font-family="monospace" font-size="12" fill="#e9e4dc" text-anchor="middle">` +
    `${jobId} · ${index + 1}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export class DevelopmentFakeVideoProvider implements VideoGenerationProvider {
  readonly providerName = 'development-fake-video';

  private runs = new Map<string, FakeVideoRun>();
  private counter = 0;

  async isConfigured(): Promise<boolean> {
    return true; // exists precisely so the full path is exercisable offline
  }

  async submitVideoGeneration(
    input: VideoGenerationRequest,
  ): Promise<{ providerRequestId: string; status: VideoGenerationStatusResult['status'] }> {
    const providerRequestId = `fakevid-${input.idempotencyKey}-${++this.counter}`;
    this.runs.set(providerRequestId, {
      request: input,
      status: 'processing',
      results: Array.from({ length: input.outputCount }, (_, index) => ({
        remoteUrlOrBytes: placeholderVideoDataUrl(input.metadata.lockflowJobId, index),
        mimeType: 'video/webm',
        durationSeconds: input.durationSeconds,
        width: input.aspectRatio === '9:16' ? 720 : input.aspectRatio === '1:1' ? 720 : 1280,
        height: input.aspectRatio === '9:16' ? 1280 : input.aspectRatio === '1:1' ? 720 : 720,
        thumbnailRemoteUrlOrBytes: placeholderThumbnailDataUrl(input.metadata.lockflowJobId, index),
      })),
    });
    return { providerRequestId, status: 'processing' };
  }

  async getVideoGenerationStatus(providerRequestId: string): Promise<VideoGenerationStatusResult> {
    const run = this.runs.get(providerRequestId);
    if (!run) {
      return { status: 'failed', errorCode: 'unknown_run', errorMessage: 'Unknown fake video request id.' };
    }
    run.status = 'completed'; // deterministic completion on first poll
    return {
      status: 'completed',
      results: run.results,
      providerMetadata: { fake: true, placeholder: true, video: true },
    };
  }
}
