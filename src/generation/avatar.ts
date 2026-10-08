/**
 * Generated avatars — real AI presenter images for the signed-in account and
 * the workspace, with a photo-upload override path from Settings.
 *
 * Storage model (same privacy stance as the OpenAI provider key): avatars
 * live in this browser's localStorage and are never written to job records,
 * Gallery metadata or the database. Two layers per key:
 *   1. `upload` — a user-provided photo (data-URI from Settings upload)
 *   2. `generated` — an AI-generated portrait (gpt-image-1, data-URI PNG)
 * Uploads win; generation only runs when no upload exists and a generated
 * image hasn't been produced yet.
 *
 * Cloud sync (opt-in): the account avatar can additionally mirror into the
 * user's private `lockflow-avatars` Supabase Storage folder through the
 * `set_my_avatar_profile` / `clear_my_avatar_profile` RPCs, so the photo
 * follows the account across devices. Cloud is read back as short-lived
 * signed URLs cached as a data-URI layer — never public URLs. The workspace
 * avatar stays local-only (it is a workspace asset, not an account one).
 */

import { getSupabase } from '../lib/supabase';

const USER_AVATAR_KEY = 'maya.avatar.user';
const WORKSPACE_AVATAR_KEY = 'maya.avatar.workspace';

const USER_API_KEY = 'maya.openai.apiKey'; // reuse the provider's storage key
const CLOUD_SYNC_KEY = 'maya.avatar.cloudSync'; // 'on' | 'off' (default off)
const CLOUD_CACHE_KEY = 'maya.avatar.cloud'; // pulled cloud image (data-URI cache)
const CLOUD_BUCKET = 'lockflow-avatars';

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
  /** Where the rendered image physically lives (absent for legacy callers). */
  sync?: 'local' | 'cloud';
}

/** Cloud mirror state for the account avatar (user kind only). */
export interface CloudSyncInfo {
  enabled: boolean;
  /** off | anonymous | idle | syncing | available | unavailable */
  status: CloudSyncStatus;
  hasCloudAvatar: boolean;
}

export type CloudSyncStatus = 'off' | 'anonymous' | 'idle' | 'syncing' | 'available' | 'unavailable';

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
  if (upload) return { src: upload, origin: 'upload', generating: false, sync: 'local' };
  if (kind === 'user') {
    const cloud = readStorage(CLOUD_CACHE_KEY);
    if (cloud) {
      return {
        src: cloud,
        origin: readStorage(`${CLOUD_CACHE_KEY}.origin`) === 'generated' ? 'generated' : 'upload',
        generating: false,
        sync: 'cloud',
      };
    }
  }
  const generated = readStorage(`${storageKey(kind)}.generated`);
  if (generated) return { src: generated, origin: 'generated', generating: false, sync: 'local' };
  return { src: null, origin: null, generating: false };
}

function cacheCloudImage(dataUri: string, origin: 'upload' | 'generated'): void {
  writeStorage(CLOUD_CACHE_KEY, dataUri);
  writeStorage(`${CLOUD_CACHE_KEY}.origin`, origin);
}

function clearCloudCache(): void {
  writeStorage(CLOUD_CACHE_KEY, null);
  writeStorage(`${CLOUD_CACHE_KEY}.origin`, null);
}

export function setUploadedAvatar(kind: AvatarKind, dataUri: string): Promise<void> {
  writeStorage(`${storageKey(kind)}.upload`, dataUri.trim() === '' ? null : dataUri);
  notify();
  if (kind !== 'user' || !isCloudSyncEnabled()) return Promise.resolve();
  // Best-effort: the local avatar is already usable; the mirror status shows
  // in Settings if the cloud copy could not be written.
  return syncToCloud(dataUri, 'upload').catch(() => undefined);
}

export function clearUploadedAvatar(kind: AvatarKind): void {
  writeStorage(`${storageKey(kind)}.upload`, null);
  notify();
  // Removing the local override also clears the cloud mirror (the RPC is the
  // single write path, so a stale mirror can never outlive the local one).
  if (kind === 'user' && isCloudSyncEnabled()) void removeCloudAvatar();
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
    if (kind === 'user' && isCloudSyncEnabled()) {
      // Non-fatal: the portrait is already usable locally; the mirror retries
      // on the next upload/generate.
      await syncToCloud(src, 'generated').catch(() => undefined);
    }
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

// ── Cloud mirror (account avatar only) ───────────────────────────────────────
// Decoupled from auth via a provider function — AuthProvider registers the
// current account id, so this module stays framework-free.

let userProvider: () => string | null = () => null;

export function setAvatarUserProvider(getUserId: () => string | null): void {
  userProvider = getUserId;
}

let cloudStatus: CloudSyncStatus = 'off';
let cloudPulledOnce = false;

export function isCloudSyncEnabled(): boolean {
  return readStorage(CLOUD_SYNC_KEY) === 'on';
}

export function getCloudSyncInfo(): CloudSyncInfo {
  const enabled = isCloudSyncEnabled();
  if (!enabled) {
    return { enabled: false, status: 'off', hasCloudAvatar: readStorage(CLOUD_CACHE_KEY) !== null };
  }
  return { enabled: true, status: cloudStatus, hasCloudAvatar: readStorage(CLOUD_CACHE_KEY) !== null };
}

export function setCloudSyncEnabled(enabled: boolean): void {
  writeStorage(CLOUD_SYNC_KEY, enabled ? 'on' : 'off');
  if (!enabled) {
    clearCloudCache();
    cloudPulledOnce = false;
    cloudStatus = 'off';
    notify();
    return;
  }
  cloudStatus = 'idle';
  notify();
  void pullCloudAvatar(true);
}

/**
 * Pulls the cloud avatar once per session (or when forced) into the local
 * cache layer. Silent by design: unavailable backends simply leave the local
 * layers in charge.
 */
export async function pullCloudAvatar(force = false): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  const client = getSupabase();
  const userId = userProvider();
  if (!client || !userId) {
    cloudStatus = getSupabase() ? 'anonymous' : 'unavailable';
    notify();
    return;
  }
  if (cloudPulledOnce && !force) return;
  cloudPulledOnce = true;
  cloudStatus = 'syncing';
  notify();
  try {
    const { data: row, error: rowError } = await client
      .from('avatar_profiles')
      .select('origin, storage_path')
      .eq('user_id', userId)
      .maybeSingle<{ origin: 'upload' | 'generated'; storage_path: string }>();
    if (rowError) throw rowError;
    if (!row) {
      clearCloudCache();
      cloudStatus = 'available'; // connected, no cloud avatar yet
      notify();
      return;
    }
    const { data: signed, error: signError } = await client.storage
      .from(CLOUD_BUCKET)
      .createSignedUrl(row.storage_path, 3600);
    if (signError || !signed?.signedUrl) throw signError ?? new Error('No signed URL');
    const response = await fetch(signed.signedUrl);
    if (!response.ok) throw new Error(`Avatar download failed (${response.status})`);
    const dataUri = await blobToDataUri(await response.blob());
    cacheCloudImage(dataUri, row.origin);
    cloudStatus = 'available';
  } catch {
    cloudStatus = 'unavailable';
  } finally {
    notify();
  }
}

/** Uploads (mirrors) an avatar image into the account's private storage folder. */
async function syncToCloud(dataUri: string, origin: 'upload' | 'generated'): Promise<void> {
  const client = getSupabase();
  const userId = userProvider();
  if (!client || !userId || !isCloudSyncEnabled()) return;
  const previous = cloudStatus;
  cloudStatus = 'syncing';
  notify();
  try {
    const prepared = await prepareForCloud(dataUri);
    const bytes = dataUriToBytes(prepared.dataUri);
    const extension = prepared.mime === 'image/png' ? 'png' : prepared.mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `avatars/${userId}/${origin}-${Date.now()}.${extension}`;
    const { error: uploadError } = await client.storage.from(CLOUD_BUCKET).upload(path, bytes, {
      contentType: prepared.mime,
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { error: rpcError } = await client.rpc('set_my_avatar_profile', {
      p_origin: origin,
      p_storage_path: path,
      p_mime_type: prepared.mime,
      p_file_size: bytes.byteLength,
    });
    if (rpcError) throw rpcError;
    // Cache the mirrored image locally so every surface reflects it at once.
    cacheCloudImage(prepared.dataUri, origin);
    cloudStatus = 'available';
  } catch (err) {
    cloudStatus = previous === 'syncing' ? 'unavailable' : previous;
    throw err instanceof Error ? err : new Error('Cloud sync failed.');
  } finally {
    notify();
  }
}

/** Clears the cloud mirror through the RPC (idempotent server-side). */
async function removeCloudAvatar(): Promise<void> {
  const client = getSupabase();
  if (!client || !userProvider()) return;
  try {
    await client.rpc('clear_my_avatar_profile');
  } catch {
    // Non-fatal: the local override is already gone; the mirror is retried on
    // the next change.
  }
  clearCloudCache();
  notify();
}

// ── Image helpers ────────────────────────────────────────────────────────────

const CLOUD_MAX_BYTES = 512 * 1024; // matches the DB constraint

interface PreparedImage {
  dataUri: string;
  mime: string;
}

/**
 * Brings an avatar image under the cloud byte budget: JPEGs that already fit
 * pass through; everything else (AI PNGs can be megabytes) is downscaled to a
 * 256×256 cover-cropped JPEG, matching the upload pipeline in Settings.
 */
async function prepareForCloud(dataUri: string): Promise<PreparedImage> {
  const mime = /^data:([^;,]+)[;,]/.exec(dataUri)?.[1] ?? 'image/png';
  if (mime === 'image/jpeg' && atob(dataUri.split(',')[1] ?? '').length <= CLOUD_MAX_BYTES) {
    return { dataUri, mime };
  }
  const image = await loadImage(dataUri);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser blocked image processing.');
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const offsetX = (image.naturalWidth - side) / 2;
  const offsetY = (image.naturalHeight - side) / 2;
  context.drawImage(image, offsetX, offsetY, side, side, 0, 0, 256, 256);
  return { dataUri: canvas.toDataURL('image/jpeg', 0.9), mime: 'image/jpeg' };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be processed.'));
    image.src = src;
  });
}

function dataUriToBytes(dataUri: string): Uint8Array {
  const base64 = dataUri.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the avatar download.'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
