/**
 * Upload validation for reference media (pure, DOM-free where possible).
 *
 * Product rules encoded here:
 *   * Allowed types: image/jpeg, image/png, image/webp — verified by file
 *     signature (magic bytes), never by extension alone; the declared MIME
 *     type must agree with the sniffed signature.
 *   * Max 10 MB, non-empty; SVG/GIF/HEIC/PDF/video/executables rejected.
 *   * Dimensions 256–8192 px per side (checked against the decoded bitmap in
 *     the browser — see readImageDimensions; documented client-side preflight,
 *     not server-side verification).
 *   * Filenames are sanitized to a safe normalized form; the raw name is
 *     never used as a path component.
 *
 * Nothing here claims scanning, recognition or classification of the image —
 * upload stores a reference image plus user-provided metadata only.
 */

export const REFERENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ReferenceMimeType = (typeof REFERENCE_MIME_TYPES)[number];

/** 10 MB — must match the DB constraints in the reference-uploads migration. */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MIN_DIMENSION_PX = 256;
export const MAX_DIMENSION_PX = 8192;

export type UploadValidationCode =
  | 'empty_file'
  | 'too_large'
  | 'unknown_type'
  | 'mime_mismatch'
  | 'disallowed_type'
  | 'too_small'
  | 'too_large_dimensions'
  | 'unreadable_image';

export class UploadValidationError extends Error {
  readonly code: UploadValidationCode;

  constructor(code: UploadValidationCode, message: string) {
    super(message);
    this.name = 'UploadValidationError';
    this.code = code;
  }
}

export interface SniffedImageType {
  mime: ReferenceMimeType;
}

/**
 * Detects the image type from the file's leading bytes. Returns null when the
 * signature matches none of the allowed formats (the caller decides whether
 * that is a disallowed known type or an unknown blob).
 */
export function sniffImageMime(bytes: Uint8Array): SniffedImageType | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { mime: 'image/png' };
  }
  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: 'image/webp' };
  }
  return null;
}

/** Human-readable labels for signatures we deliberately reject. */
function describeRejectedSignature(bytes: Uint8Array): string | null {
  const ascii = (start: number, text: string) =>
    text.split('').every((char, index) => bytes[start + index] === char.charCodeAt(0));
  if (ascii(0, 'GIF8')) return 'GIF images are not supported';
  if (ascii(0, '%PDF')) return 'PDF files are not supported';
  if (ascii(0, '<?xml') || ascii(0, '<svg')) return 'SVG files are not supported';
  if (bytes.length >= 12 && ascii(4, 'ftyp')) return 'HEIC/MP4-style containers are not supported';
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'Executable files are not allowed';
  if (bytes.length >= 2 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return 'Executable files are not allowed';
  }
  return null;
}

export interface FileMetadata {
  name: string;
  size: number;
  type: string;
}

export interface ValidatedUploadMeta {
  safeFilename: string;
  /** The sniffed signature — the value recorded as the file's MIME type. */
  sniffedMime: ReferenceMimeType;
  declaredMime: string;
  sizeBytes: number;
}

/**
 * Validates a file's metadata + leading bytes WITHOUT decoding the image
 * (usable in tests and workers). Throws UploadValidationError with a
 * human-readable message on any failure.
 */
export function validateFileMetadata(
  file: FileMetadata,
  headBytes: Uint8Array,
): ValidatedUploadMeta {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new UploadValidationError('empty_file', 'That file is empty — choose an image with content.');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new UploadValidationError(
      'too_large',
      `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 10 MB.`,
    );
  }

  const sniffed = sniffImageMime(headBytes);
  if (!sniffed) {
    const rejected = describeRejectedSignature(headBytes);
    throw new UploadValidationError(
      rejected ? 'disallowed_type' : 'unknown_type',
      rejected ?? 'That file type is not supported — use JPEG, PNG or WebP.',
    );
  }

  // Declared MIME must agree with the signature when the browser provides one
  // (it always does for real File objects; empty string is tolerated).
  if (file.type && file.type !== sniffed.mime) {
    throw new UploadValidationError(
      'mime_mismatch',
      'This file’s content does not match its declared type — it may be renamed or corrupted.',
    );
  }

  return {
    safeFilename: sanitizeFilename(file.name, sniffed.mime),
    sniffedMime: sniffed.mime,
    declaredMime: file.type,
    sizeBytes: file.size,
  };
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Decodes the image to read its true dimensions. Returns null when the
 * environment cannot decode at all (node/tests, no DOM) — the caller then
 * records no dimensions rather than inventing a validation result. A real
 * browser Blob that fails to decode throws (corrupt file).
 */
export async function readImageDimensions(file: Blob): Promise<ImageDimensions | null> {
  const canDecode = typeof Blob !== 'undefined' && file instanceof Blob;
  if (!canDecode) return null;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      throw new UploadValidationError('unreadable_image', 'That image could not be decoded — it may be corrupted.');
    }
  }

  // Fallback for environments without createImageBitmap.
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('decode failed'));
      element.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    throw new UploadValidationError('unreadable_image', 'That image could not be decoded — it may be corrupted.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function validateDimensions(dimensions: ImageDimensions): void {
  if (
    dimensions.width < MIN_DIMENSION_PX ||
    dimensions.height < MIN_DIMENSION_PX
  ) {
    throw new UploadValidationError(
      'too_small',
      `Images must be at least ${MIN_DIMENSION_PX}×${MIN_DIMENSION_PX} px — this one is ${dimensions.width}×${dimensions.height}.`,
    );
  }
  if (
    dimensions.width > MAX_DIMENSION_PX ||
    dimensions.height > MAX_DIMENSION_PX
  ) {
    throw new UploadValidationError(
      'too_large_dimensions',
      `Images must be at most ${MAX_DIMENSION_PX}×${MAX_DIMENSION_PX} px — this one is ${dimensions.width}×${dimensions.height}.`,
    );
  }
}

/**
 * Normalizes a user-supplied filename to a safe path component: basename only
 * (no traversal), lowercased, restricted to [a-z0-9._-], trimmed of leading
 * trailing separators. The extension is replaced by the verified type's
 * canonical one so the stored name can never disagree with the content.
 */
export function sanitizeFilename(rawName: string, mime: ReferenceMimeType): string {
  const canonicalExtension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';

  // Basename only: strip every directory component (both separators) — this
  // kills "../" traversal and absolute paths in one move.
  const base = rawName.split(/[/\\]/).pop() ?? '';
  const stem = base
    .replace(/\.[^.]*$/, '') // drop the (untrusted) extension
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-') // unsafe chars → separator
    .replace(/^[._-]+|[._-]+$/g, '') // trim leading/trailing separators
    .slice(0, 64)
    .replace(/^[._-]+|[._-]+$/g, '');

  return `${stem || 'reference'}.${canonicalExtension}`;
}

/** Reads the first bytes of a File for signature sniffing. */
export async function readFileHead(file: Blob, length = 16): Promise<Uint8Array> {
  const buffer = await file.slice(0, length).arrayBuffer();
  return new Uint8Array(buffer);
}
