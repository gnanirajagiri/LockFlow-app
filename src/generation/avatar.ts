/**
 * Generated avatars — real AI presenter images for the signed-in account and
 * the workspace, with a photo-upload override path from Settings.
 *
 * Storage model (same privacy stance as the OpenAI provider key): the avatar
 * lives ONLY in this browser's localStorage and is never written to job
 * records, Gallery metadata or the database. Two layers per key:
 *   1. `upload` — a user-provided photo (data-URI from Settings upload)
 *   2. `generated` — an AI-generated portrait (gpt-image-1, data-URI PNG)
 * Uploads win; generation only runs when no upload exists and a generated
 * image hasn't been produced yet.
 */

const USER_AVATAR_KEY = 'maya.avatar.user';
const WORKSPACE_AVATAR_KEY = 'maya.avatar.workspace';

const USER_API_KEY = 'maya.openai.apiKey'; // reuse the provider's storage key
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const GENERATION_PROMPT =
  'Professional headshot portrait avatar, friendly natural expression, soft warm studio lighting, ' +
  'clean neutral cream background, shallow depth of field, modern minimal aesthetic, square crop, ' +
  'photorealistic';

export type AvatarKind = 'user' | 'workspace';

function storageKey(kind: AvatarKind): string {
  return kind === 'user' ? USER_AVATAR_KEY : WORKSPACE_AVATAR_KEY;
}

export interface AvatarSource {
  /** Ready-to-render src, or null when nothing is stored yet. */
  src: string | null;
  /** Where the image came from. */
  origin: 'upload' | 'generated' | null;
  /** True while an OpenAI generation request is in flight. */
  generating: boolean;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode / quota) — avatar falls back to initials.
  }
}

export function getAvatar(kind: AvatarKind): AvatarSource {
  const upload = readStorage(`${storageKey(kind)}.upload`);
  if (upload) return { src: upload, origin: 'upload', generating: false };
  const generated = readStorage(`${storageKey(kind)}.generated`);
  if (generated) return { src: generated, origin: 'generated', generating: false };
  return { src: null, origin: null, generating: false };
}

export function setUploadedAvatar(kind: AvatarKind, dataUri: string): void {
  writeStorage(`${storageKey(kind)}.upload`, dataUri.trim() === '' ? null : dataUri);
  notify();
}

export function clearUploadedAvatar(kind: AvatarKind): void {
  writeStorage(`${storageKey(kind)}.upload`, null);
  notify();
}

/** Removes the generated image so the next generateAvatar() call produces a new one. */
export function clearGeneratedAvatar(kind: AvatarKind): void {
  writeStorage(`${storageKey(kind)}.generated`, null);
  notify();
}

function getApiKey(): string {
  try {
    return window.localStorage.getItem(USER_API_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Generates a portrait with gpt-image-1 (the same provider configured in
 * Settings) and stores it. Requires the OpenAI provider to be configured;
 * callers surface failures as toasts. Generation runs in the background —
 * subscribe() fires again when it lands.
 */
export async function generateAvatar(kind: AvatarKind): Promise<void> {
  const apiKey = getApiKey().trim();
  if (apiKey === '') {
    throw new Error('Add an OpenAI API key in Settings first — avatar generation uses gpt-image-1.');
  }
  if (getAvatar(kind).generating) return; // one in flight per avatar
  setTransientGenerating(kind, true);
  try {
    const response = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: GENERATION_PROMPT, n: 1, size: '1024x1024' }),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'OpenAI rejected the API key. Check it in Settings.'
          : response.status === 429
            ? 'OpenAI rate limit reached — try again shortly.'
            : 'OpenAI could not generate the avatar right now.',
      );
    }
    const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = payload.data?.[0];
    const src = item?.b64_json
      ? `data:image/png;base64,${item.b64_json}`
      : item?.url ?? null;
    if (!src) throw new Error('OpenAI returned no image for this avatar.');
    writeStorage(`${storageKey(kind)}.generated`, src);
    notify();
  } finally {
    setTransientGenerating(kind, false);
  }
}

// `generating` is intentionally session-transient: a refresh simply forgets an
// in-flight render, and re-clicking starts a fresh one.
const generatingState: Record<AvatarKind, boolean> = { user: false, workspace: false };

function setTransientGenerating(kind: AvatarKind, value: boolean): void {
  generatingState[kind] = value;
  notify();
}

// ── Change notification ───────────────────────────────────────────────────────
// The topbar and Settings both read localStorage; a tiny listener list keeps
// them in sync without pulling in a store dependency.

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToAvatars(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
