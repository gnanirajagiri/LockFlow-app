/**
 * Reference thumbnail — renders a real upload through a short-lived signed
 * URL, or the placeholder frame for metadata-only rows (development seeds
 * and rows whose file is not uploaded yet). Never renders a permanent public
 * URL; signed URLs live in memory only.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ReferencesMediaService } from './referencesMediaService';
import type { ReferenceTargetType } from './storagePaths';

export interface ReferenceMediaRow {
  id: string;
  caption: string;
  referenceType: string;
  uploadStatus?: 'pending' | 'uploaded' | 'failed' | 'deleted';
  mimeType?: string | null;
  storageBucket?: string | null;
}

export interface ReferenceMediaProps {
  service: ReferencesMediaService;
  targetType: ReferenceTargetType;
  reference: ReferenceMediaRow;
  fallbackIcon: ReactNode;
  typeLabel: string;
}

export function ReferenceMedia({ service, targetType, reference, fallbackIcon, typeLabel }: ReferenceMediaProps) {
  const isRealUpload =
    reference.uploadStatus === 'uploaded' &&
    Boolean(reference.mimeType) &&
    Boolean(reference.storageBucket);

  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isRealUpload) {
      setUrl(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    service
      .createViewUrl(reference.id, targetType)
      .then((signedUrl) => {
        if (!cancelled) {
          setUrl(signedUrl);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [service, reference.id, targetType, isRealUpload]);

  if (url) {
    return (
      <img
        className="lf-refcard__image"
        src={url}
        alt={reference.caption || `${typeLabel} reference`}
        loading="lazy"
      />
    );
  }

  return (
    <div className="lf-refcard__frame" aria-hidden="true" title={failed ? 'Preview unavailable' : undefined}>
      {fallbackIcon}
      <span className="lf-refcard__type">{typeLabel}</span>
      {failed ? <span className="lf-refcard__status">Preview unavailable</span> : null}
    </div>
  );
}

/** Status chip for pending/failed uploads (uploaded rows render clean). */
export function UploadStatusChip({ status }: { status: ReferenceMediaRow['uploadStatus'] }) {
  if (!status || status === 'uploaded') return null;
  const label = status === 'pending' ? 'Upload pending' : status === 'failed' ? 'Upload failed' : 'Removed';
  return <span className={`lf-uploadchip lf-uploadchip--${status}`}>{label}</span>;
}

export type { ReferencesMediaService };
