/**
 * Provider registry — the ONLY place a provider adapter is selected. UI code
 * never imports adapters; the service resolves by the configured name and
 * fails closed for unknown/unconfigured providers (production safety rule 5).
 */
import type { ImageGenerationProvider } from './types';
import { DevelopmentFakeImageProvider } from './fakeProvider';

const adapters = new Map<string, ImageGenerationProvider>();

/** The development fake is always registered; it is only *selected* when the
 *  config names it (dev/tests) — never as a production fallback. */
adapters.set('development-fake', new DevelopmentFakeImageProvider());

export function registerImageProvider(adapter: ImageGenerationProvider): void {
  adapters.set(adapter.providerName, adapter);
}

export function getImageProvider(name: string): ImageGenerationProvider | null {
  return adapters.get(name) ?? null;
}

export function listImageProviders(): string[] {
  return [...adapters.keys()];
}
