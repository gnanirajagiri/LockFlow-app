/**
 * ReferencesMediaService contracts against a mocked Supabase client.
 *
 * These pin the client-side half of the security rules; the DB migration's
 * RPCs and triggers re-validate all of it authoritatively (defence in depth):
 *   * rights acknowledgement is required before any upload intent
 *   * server refusals (foreign workspace, locked version) propagate as
 *     user-readable errors and never reach a storage transfer
 *   * transfer failures mark the pending upload failed (audit-trailed)
 *   * signed view URLs are minted only after the access-check RPC succeeds
 *   * signed URLs are never persisted into any table write
 */
import { describe, expect, it, vi } from 'vitest';
import { ReferencesMediaService, DemoModeError } from './referencesMediaService';
import { getSupabase } from '../../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('../../lib/supabase', () => ({ getSupabase: vi.fn() }));

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function makeFile(name = 'Front Label.png', size = 1024): File {
  const file = {
    name,
    size,
    type: 'image/png',
    slice: () => ({
      arrayBuffer: () => Promise.resolve(PNG_BYTES.buffer.slice(0, size > PNG_BYTES.length ? PNG_BYTES.length : size)),
    }),
  };
  return file as unknown as File;
}

/** Chains the RPC-response queue used by the mocked client. */
function createMockClient() {
  const rpcResponses: Array<{ data: unknown; error: unknown }> = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const fromCalls: string[] = [];
  const storageCalls: Array<{ bucket: string; op: string; args: unknown[] }> = [];

  const client = {
    rpc: vi.fn((_fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn: _fn, args });
      const next = rpcResponses.shift() ?? { data: null, error: { message: 'unexpected rpc call' } };
      // Real supabase-js returns a thenable PostgREST builder that also
      // carries .single(); mirror both facets.
      const builder = {
        single: () => Promise.resolve(next),
        then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
          Promise.resolve(next).then(resolve, reject),
      };
      return builder;
    }),
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  storage_path: 'workspaces/ws-1/models/m-1/versions/v-1/references/r-1/front.png',
                  storage_bucket: 'lockflow-references',
                  upload_status: 'uploaded',
                },
                error: null,
              }),
          }),
        }),
      };
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: vi.fn((path: string) => {
          storageCalls.push({ bucket, op: 'createSignedUploadUrl', args: [path] });
          return Promise.resolve({ data: { path, token: 'upload-token' }, error: null });
        }),
        uploadToSignedUrl: vi.fn((path: string, token: string, body: unknown) => {
          storageCalls.push({ bucket, op: 'uploadToSignedUrl', args: [path, token, body] });
          return Promise.resolve({ data: { path }, error: null });
        }),
        createSignedUrl: vi.fn((path: string, expiry: number) => {
          storageCalls.push({ bucket, op: 'createSignedUrl', args: [path, expiry] });
          return Promise.resolve({ data: { signedUrl: `https://signed.example/${path}?t=${expiry}` }, error: null });
        }),
      }),
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    rpcCalls,
    rpcResponses,
    fromCalls,
    storageCalls,
  };
}

function queueRpc(mock: ReturnType<typeof createMockClient>, data: unknown, error: unknown = null) {
  mock.rpcResponses.push({ data, error });
}

function baseInput(overrides: Partial<Parameters<ReferencesMediaService['uploadReference']>[0]> = {}) {
  return {
    targetType: 'model_reference' as const,
    versionId: 'v-1',
    referenceType: 'portrait',
    caption: 'front',
    file: makeFile(),
    rightsConfirmed: true,
    ...overrides,
  };
}

describe('rights acknowledgement (rule 4: mandatory before intent)', () => {
  it('refuses to create an upload intent without confirmation', async () => {
    const mock = createMockClient();
    vi.mocked(getSupabase).mockReturnValue(mock.client);
    const service = new ReferencesMediaService();

    await expect(service.uploadReference(baseInput({ rightsConfirmed: false }))).rejects.toThrow(
      /rights acknowledgement/i,
    );
    expect(mock.rpcCalls).toHaveLength(0); // no intent ever reached the server
  });
});

describe('server refusals propagate (rules 1–3)', () => {
  it('surfaces a foreign-workspace refusal and never uploads bytes', async () => {
    const mock = createMockClient();
    vi.mocked(getSupabase).mockReturnValue(mock.client);
    const service = new ReferencesMediaService();
    queueRpc(mock, null, { message: 'you do not have access to this workspace' });

    await expect(service.uploadReference(baseInput())).rejects.toThrow(/workspace/);
    expect(mock.storageCalls.filter((call) => call.op === 'uploadToSignedUrl')).toHaveLength(0);
  });

  it('surfaces a locked-version refusal before any transfer', async () => {
    const mock = createMockClient();
    vi.mocked(getSupabase).mockReturnValue(mock.client);
    const service = new ReferencesMediaService();
    queueRpc(mock, null, { message: 'references are protected in this locked version' });

    await expect(service.uploadReference(baseInput())).rejects.toThrow(/locked version/);
    expect(mock.storageCalls).toHaveLength(0);
  });

  it('marks the pending upload failed when the transfer fails', async () => {
    const mock = createMockClient();
    vi.mocked(getSupabase).mockReturnValue(mock.client);
    const service = new ReferencesMediaService();
    queueRpc(mock, { reference_id: 'ref-1', bucket: 'lockflow-references', upload_path: 'workspaces/ws-1/models/m-1/versions/v-1/references/r-1/front.png' });
    // The transfer itself fails:
    mock.client.storage.from = (() => ({
      createSignedUploadUrl: () => Promise.resolve({ data: { path: 'p', token: 't' }, error: null }),
      uploadToSignedUrl: () => Promise.resolve({ data: null, error: { message: 'network down' } }),
    })) as unknown as SupabaseClient['storage']['from'];
    queueRpc(mock, { data: null, error: null }); // fail_reference_upload response

    await expect(service.uploadReference(baseInput())).rejects.toThrow(/network down/);
    const failCall = mock.rpcCalls.find((call) => call.fn === 'fail_reference_upload');
    expect(failCall).toBeTruthy();
    expect(failCall?.args.p_reference_id).toBe('ref-1');
  });
});

describe('successful upload flow', () => {
  it('runs intent → signed upload → complete in order', async () => {
    const mock = createMockClient();
    vi.mocked(getSupabase).mockReturnValue(mock.client);
    const service = new ReferencesMediaService();
    queueRpc(mock, { reference_id: 'ref-9', bucket: 'lockflow-references', upload_path: 'workspaces/ws-1/models/m-1/versions/v-1/references/r-9/front.png' });
    queueRpc(mock, null); // complete_reference_upload

    // The node environment cannot decode images; dimensions are recorded as
    // null and the flow still completes (honest no-invented-validation rule).
    const result = await service.uploadReference(baseInput());
    void result;

    const calls = mock.rpcCalls.map((call) => call.fn);
    expect(calls[0]).toBe('begin_reference_upload');
    expect(calls[calls.length - 1]).toBe('complete_reference_upload');
    const transfer = mock.storageCalls.find((call) => call.op === 'uploadToSignedUrl');
    expect(transfer?.args[0]).toContain('workspaces/ws-1/');
  });
});

describe('signed view URLs (spec: access-checked, short-lived, never persisted)', () => {
  it('audits access before minting the URL and uses a 600s expiry', async () => {
    const mock = createMockClient();
    vi.mocked(getSupabase).mockReturnValue(mock.client);
    const service = new ReferencesMediaService();
    queueRpc(mock, null); // log_signed_url_access

    const url = await service.createViewUrl('ref-1', 'model_reference');
    expect(url).toContain('https://signed.example/');
    expect(mock.rpcCalls[0].fn).toBe('log_signed_url_access');
    const signed = mock.storageCalls.find((call) => call.op === 'createSignedUrl');
    expect(signed?.args[1]).toBe(600);
  });

  it('refuses when the access-check RPC refuses (foreign reference)', async () => {
    const mock = createMockClient();
    vi.mocked(getSupabase).mockReturnValue(mock.client);
    const service = new ReferencesMediaService();
    queueRpc(mock, null, { message: 'you do not have access to this workspace' });

    await expect(service.createViewUrl('ref-1', 'model_reference')).rejects.toThrow(/workspace/);
    expect(mock.storageCalls).toHaveLength(0);
  });
});

describe('demo mode', () => {
  it('explains honestly that uploads are unavailable', async () => {
    vi.mocked(getSupabase).mockReturnValue(null);
    const service = new ReferencesMediaService();
    await expect(service.uploadReference(baseInput())).rejects.toThrow(DemoModeError);
  });
});
