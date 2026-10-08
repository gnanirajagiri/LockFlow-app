// @vitest-environment happy-dom
/**
 * Avatar lifecycle — localStorage layering (upload wins over generated),
 * remove semantics and the opt-in cloud mirror. The Supabase boundary is a
 * hoisted mock; the plain toggle is exercised without any network by design
 * (demo mode has no Supabase client).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabase } from '../lib/supabase';
import {
  clearGeneratedAvatar,
  clearUploadedAvatar,
  getAvatar,
  getCloudSyncInfo,
  isCloudSyncEnabled,
  setAvatarUserProvider,
  setCloudSyncEnabled,
  setUploadedAvatar,
  subscribeToAvatars,
  pullCloudAvatar,
} from './avatar';

vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn(() => null) }));

const mockGetSupabase = vi.mocked(getSupabase);

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// A tiny but structurally valid JPEG — passes the cloud byte budget untouched.
const JPEG_DATA_URI = `data:image/jpeg;base64,${btoa('tiny-valid-jpeg-bytes')}`;

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mockGetSupabase.mockReturnValue(null);
  setAvatarUserProvider(() => null);
});

afterEach(() => {
  window.localStorage.clear();
});

describe('avatar layering (localStorage)', () => {
  it('starts empty with no origin', () => {
    expect(getAvatar('user')).toMatchObject({ src: null, origin: null, generating: false });
    expect(getAvatar('workspace')).toMatchObject({ src: null, origin: null });
  });

  it('stores an upload and reports it as the current origin', async () => {
    await setUploadedAvatar('user', JPEG_DATA_URI);
    expect(getAvatar('user')).toMatchObject({ src: JPEG_DATA_URI, origin: 'upload', sync: 'local' });
  });

  it('keeps upload winning over a generated portrait, then falls back on removal', () => {
    window.localStorage.setItem('maya.avatar.user.generated', PNG_DATA_URI);
    expect(getAvatar('user')).toMatchObject({ origin: 'generated', sync: 'local' });

    setUploadedAvatar('user', JPEG_DATA_URI);
    expect(getAvatar('user')).toMatchObject({ origin: 'upload' });

    clearUploadedAvatar('user');
    expect(getAvatar('user')).toMatchObject({ origin: 'generated' });
  });

  it('clears the generated layer on demand', () => {
    window.localStorage.setItem('maya.avatar.workspace.generated', PNG_DATA_URI);
    clearGeneratedAvatar('workspace');
    expect(getAvatar('workspace').src).toBeNull();
  });

  it('rejects empty upload payloads by storing nothing', async () => {
    await setUploadedAvatar('user', '   ');
    expect(getAvatar('user').src).toBeNull();
  });

  it('notifies subscribers on every change until unsubscribed', async () => {
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeToAvatars(() => seen.push(getAvatar('user').src));
    await setUploadedAvatar('user', JPEG_DATA_URI);
    clearUploadedAvatar('user');
    unsubscribe();
    clearGeneratedAvatar('user');
    expect(seen).toEqual([JPEG_DATA_URI, null]);
  });
});

describe('cloud sync toggle (no network by design in demo mode)', () => {
  it('is off by default and keeps uploads purely local', async () => {
    expect(isCloudSyncEnabled()).toBe(false);
    expect(getCloudSyncInfo()).toEqual({ enabled: false, status: 'off', hasCloudAvatar: false });

    await setUploadedAvatar('user', JPEG_DATA_URI);
    expect(window.localStorage.getItem('maya.avatar.user.upload')).toBe(JPEG_DATA_URI);
    expect(getAvatar('user').sync).toBe('local');
  });

  it('toggles on, reports unavailable without a backend, toggles off', async () => {
    setCloudSyncEnabled(true);
    expect(isCloudSyncEnabled()).toBe(true);

    // Demo mode: getSupabase() is null, so the pull settles as unavailable.
    await vi.waitFor(() => expect(getCloudSyncInfo().status).toBe('unavailable'));
    await pullCloudAvatar(true);
    expect(getCloudSyncInfo().status).toBe('unavailable');

    setCloudSyncEnabled(false);
    expect(isCloudSyncEnabled()).toBe(false);
    expect(getCloudSyncInfo()).toEqual({ enabled: false, status: 'off', hasCloudAvatar: false });
  });

  it('clears the cached cloud layer when sync is switched off', () => {
    window.localStorage.setItem('maya.avatar.cloud', PNG_DATA_URI);
    window.localStorage.setItem('maya.avatar.cloud.origin', 'generated');
    setCloudSyncEnabled(false);
    expect(getAvatar('user').sync).not.toBe('cloud');
    expect(getCloudSyncInfo().hasCloudAvatar).toBe(false);
  });
});

describe('cloud mirror against a faked Supabase client', () => {
  it('pulls a cloud avatar into the cache layer', async () => {
    mockGetSupabase.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { origin: 'generated', storage_path: 'avatars/u-1/generated-123.png' },
              error: null,
            }),
          }),
        }),
      }) as never,
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/avatar' }, error: null }),
        }),
      } as never,
    } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([PNG_DATA_URI], { type: 'image/png' }) }),
    );
    try {
      setAvatarUserProvider(() => 'u-1');
      setCloudSyncEnabled(true);
      await pullCloudAvatar(true);
      expect(getAvatar('user')).toMatchObject({ sync: 'cloud', origin: 'generated' });
      expect(getAvatar('user').src).toContain('data:image/png');
      expect(getCloudSyncInfo()).toMatchObject({ enabled: true, status: 'available', hasCloudAvatar: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mirrors an upload to cloud storage through the RPC when enabled', async () => {
    const calls: Array<{ kind: string; path?: string; rpc?: string; body?: Record<string, unknown> }> = [];
    mockGetSupabase.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      storage: {
        from: () => ({
          upload: async (path: string) => {
            calls.push({ kind: 'upload', path });
            return { error: null };
          },
        }),
      } as never,
      rpc: async (name: string, payload: Record<string, unknown>) => {
        calls.push({ kind: 'rpc', rpc: name, body: payload });
        return { error: null };
      },
    } as never);
    try {
      setAvatarUserProvider(() => 'u-1');
      setCloudSyncEnabled(true);
      await setUploadedAvatar('user', JPEG_DATA_URI);
      expect(calls.some((call) => call.kind === 'upload' && call.path?.startsWith('avatars/u-1/upload-'))).toBe(true);
      expect(calls.find((call) => call.rpc === 'set_my_avatar_profile')?.body).toMatchObject({
        p_origin: 'upload',
        p_mime_type: 'image/jpeg',
      });
      // The local layer still wins for rendering; the cloud copy is a mirror.
      expect(getAvatar('user')).toMatchObject({ origin: 'upload', sync: 'local' });
    } finally {
      mockGetSupabase.mockReturnValue(null);
    }
  });

  it('never lets a cloud failure break a local upload', async () => {
    mockGetSupabase.mockReturnValue({
      storage: {
        from: () => ({
          upload: async () => ({ error: new Error('storage down') }),
        }),
      } as never,
    } as never);
    try {
      setAvatarUserProvider(() => 'u-1');
      setCloudSyncEnabled(true);
      await expect(setUploadedAvatar('user', JPEG_DATA_URI)).resolves.toBeUndefined();
      expect(getAvatar('user')).toMatchObject({ origin: 'upload', sync: 'local' });
      await vi.waitFor(() => expect(getCloudSyncInfo().status).toBe('unavailable'));
    } finally {
      mockGetSupabase.mockReturnValue(null);
    }
  });
});
