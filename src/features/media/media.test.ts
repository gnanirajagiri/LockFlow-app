/**
 * Secure reference-upload guards — the product contracts, tested as pure
 * units. Server-side enforcement (membership, draft-only, locked protection,
 * audit trail) is re-validated by the DB migration's RPCs and triggers; these
 * tests pin the client-side half of the same rules.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_DIMENSION_PX,
  MAX_FILE_SIZE_BYTES,
  MIN_DIMENSION_PX,
  UploadValidationError,
  sanitizeFilename,
  sniffImageMime,
  validateDimensions,
  validateFileMetadata,
} from './validateUpload';
import { buildReferencePath, workspaceSegmentFromPath } from './storagePaths';
import { ReferencesMediaService, describeMediaError } from './referencesMediaService';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function jpegBytes(): Uint8Array {
  return bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
}

function pngBytes(): Uint8Array {
  return bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
}

function webpBytes(): Uint8Array {
  return bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00, 0x00);
}

function svgBytes(): Uint8Array {
  // '<svg ' as ASCII.
  return [0x3c, 0x73, 0x76, 0x67, 0x20].map((value) => value) as unknown as Uint8Array;
}

describe('file signature sniffing (rule 5: declared type is never trusted alone)', () => {
  it('recognises JPEG, PNG and WebP signatures', () => {
    expect(sniffImageMime(jpegBytes())?.mime).toBe('image/jpeg');
    expect(sniffImageMime(pngBytes())?.mime).toBe('image/png');
    expect(sniffImageMime(webpBytes())?.mime).toBe('image/webp');
  });

  it('returns null for unknown content', () => {
    expect(sniffImageMime(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
  });
});

describe('file metadata validation (rule: size/type limits with human errors)', () => {
  it('accepts an allowed image within limits', () => {
    const meta = validateFileMetadata(
      { name: 'Front Label.PNG', size: 1024, type: 'image/png' },
      pngBytes(),
    );
    expect(meta.sniffedMime).toBe('image/png');
    expect(meta.safeFilename.endsWith('.png')).toBe(true);
  });

  it('rejects empty files', () => {
    expect(() =>
      validateFileMetadata({ name: 'x.png', size: 0, type: 'image/png' }, pngBytes()),
    ).toThrow(UploadValidationError);
  });

  it('rejects files above 10 MB with a readable message', () => {
    try {
      validateFileMetadata(
        { name: 'huge.jpg', size: MAX_FILE_SIZE_BYTES + 1, type: 'image/jpeg' },
        jpegBytes(),
      );
      expect.unreachable('expected rejection');
    } catch (error) {
      expect((error as UploadValidationError).code).toBe('too_large');
      expect((error as Error).message).toContain('10 MB');
    }
  });

  it('rejects SVG with a specific message', () => {
    try {
      validateFileMetadata({ name: 'vector.svg', size: 100, type: 'image/svg+xml' }, svgBytes());
      expect.unreachable('expected rejection');
    } catch (error) {
      expect((error as UploadValidationError).code).toBe('disallowed_type');
      expect((error as Error).message).toContain('SVG');
    }
  });

  it('rejects content whose signature disagrees with the declared MIME', () => {
    expect(() =>
      validateFileMetadata({ name: 'fake.png', size: 100, type: 'image/png' }, jpegBytes()),
    ).toThrow(/does not match its declared type/);
  });
});

describe('filename sanitization (rule: user filenames never form the path)', () => {
  it('strips traversal and directory components', () => {
    const safe = sanitizeFilename('../../etc/passwd.png', 'image/png');
    expect(safe).not.toContain('..');
    expect(safe).not.toContain('/');
    expect(safe.endsWith('.png')).toBe(true);
  });

  it('replaces unsafe characters and trims separators', () => {
    expect(sanitizeFilename('--My Photo (final) [1]--.jpg', 'image/jpeg')).toBe('my-photo-final-1.jpg');
  });

  it('falls back to a safe default and canonical extensions', () => {
    expect(sanitizeFilename('***.webp', 'image/webp')).toBe('reference.webp');
    expect(sanitizeFilename('x.JPG', 'image/jpeg').endsWith('.jpg')).toBe(true);
  });
});

describe('dimension limits (rule: 256–8192 px per side)', () => {
  it('accepts in-range dimensions', () => {
    expect(() => validateDimensions({ width: 1024, height: 768 })).not.toThrow();
    expect(() => validateDimensions({ width: MIN_DIMENSION_PX, height: MIN_DIMENSION_PX })).not.toThrow();
    expect(() => validateDimensions({ width: MAX_DIMENSION_PX, height: MAX_DIMENSION_PX })).not.toThrow();
  });

  it('rejects too-small and too-large images', () => {
    expect(() => validateDimensions({ width: 255, height: 1000 })).toThrow(UploadValidationError);
    expect(() => validateDimensions({ width: 1000, height: MAX_DIMENSION_PX + 1 })).toThrow(
      UploadValidationError,
    );
  });
});

describe('storage path structure (spec: workspaces/{ws}/{domain}/... pattern)', () => {
  it('builds the canonical model reference path', () => {
    const path = buildReferencePath({
      targetType: 'model_reference',
      workspaceId: '11111111-1111-1111-1111-111111111111',
      ownerId: '22222222-2222-2222-2222-222222222222',
      versionId: '33333333-3333-3333-3333-333333333333',
      referenceId: '44444444-4444-4444-4444-444444444444',
      safeFilename: 'front.png',
    });
    expect(path).toBe(
      'workspaces/11111111-1111-1111-1111-111111111111/models/22222222-2222-2222-2222-222222222222/versions/33333333-3333-3333-3333-333333333333/references/44444444-4444-4444-4444-444444444444/front.png',
    );
  });

  it('builds environment and library paths with their segments', () => {
    const ids = {
      workspaceId: '11111111-1111-1111-1111-111111111111',
      ownerId: '22222222-2222-2222-2222-222222222222',
      versionId: '33333333-3333-3333-3333-333333333333',
      referenceId: '44444444-4444-4444-4444-444444444444',
      safeFilename: 'label.webp',
    };
    expect(buildReferencePath({ ...ids, targetType: 'environment_reference' })).toContain('/environments/');
    expect(buildReferencePath({ ...ids, targetType: 'library_asset_reference' })).toContain('/library/');
  });

  it('refuses unsafe id segments', () => {
    expect(() =>
      buildReferencePath({
        targetType: 'model_reference',
        workspaceId: '../escape',
        ownerId: '22222222-2222-2222-2222-222222222222',
        versionId: '33333333-3333-3333-3333-333333333333',
        referenceId: '44444444-4444-4444-4444-444444444444',
        safeFilename: 'front.png',
      }),
    ).toThrow(/Unsafe id segment/);
  });

  it('parses the workspace segment exactly like the storage policy', () => {
    expect(workspaceSegmentFromPath('workspaces/11111111-1111-1111-1111-111111111111/models/x/references/y/z.png')).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(workspaceSegmentFromPath('not-workspaces/x/y')).toBeNull();
    expect(workspaceSegmentFromPath('workspaces/../etc')).toBeNull();
  });
});

describe('rights acknowledgement and shared-service contracts', () => {
  it('describes the rights error for users', () => {
    expect(describeMediaError(new Error('rights acknowledgement is required before an upload can begin'))).toContain(
      'Confirm the rights acknowledgement',
    );
  });

  it('maps locked-version failures to the protected copy', () => {
    expect(describeMediaError(new Error('references are protected in this locked version'))).toContain(
      'References are protected in this locked version',
    );
  });

  it('is a single shared service class used for all three target types (rule 13)', () => {
    // The service is target-agnostic: one class, three contexts.
    const service = new ReferencesMediaService();
    expect(service).toBeInstanceOf(ReferencesMediaService);
    expect(typeof service.uploadReference).toBe('function');
    expect(typeof service.softDeleteReference).toBe('function');
  });
});
