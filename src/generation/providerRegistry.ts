/**
 * Provider registry — the ONLY place a provider adapter is selected. UI code
 * never imports adapters; the service resolves by the configured name and
 * fails closed for unknown/unconfigured providers (production safety rule 5).
 */
import type { ImageGenerationProvider } from './types';
import { DevelopmentFakeImageProvider } from './fakeProvider';
import type { VideoGenerationProvider } from './videoTypes';
import { DevelopmentFakeVideoProvider } from './videoFakeProvider';

const adapters = new Map<string, ImageGenerationProvider>();
const videoAdapters = new Map<string, VideoGenerationProvider>();

/** The development fakes are always registered; they are only *selected*
 *  when the config names them (dev/tests) — never as production fallbacks. */
adapters.set('development-fake', new DevelopmentFakeImageProvider());
videoAdapters.set('development-fake-video', new DevelopmentFakeVideoProvider());

export function registerImageProvider(adapter: ImageGenerationProvider): void {
  adapters.set(adapter.providerName, adapter);
}

export function registerVideoProvider(adapter: VideoGenerationProvider): void {
  videoAdapters.set(adapter.providerName, adapter);
}

export function getImageProvider(name: string): ImageGenerationProvider | null {
  return adapters.get(name) ?? null;
}

export function getVideoProvider(name: string): VideoGenerationProvider | null {
  return videoAdapters.get(name) ?? null;
}

export function listImageProviders(): string[] {
  return [...adapters.keys()];
}

export function listVideoProviders(): string[] {
  return [...videoAdapters.keys()];
}
