/**
 * Reusable, accessible upload dialog for reference media.
 *
 * Used by all three reference surfaces (Model, Environment, Library) with
 * their own type enums. Requirements implemented here:
 *   * drag-and-drop zone plus keyboard-reachable file picker
 *   * required rights acknowledgement BEFORE an upload intent is created
 *   * client-side validation with human-readable errors (per-file status)
 *   * pending/uploaded/failed states with retry-when-safe
 *   * honest, indeterminate progress (supabase-js has no byte-level events)
 *
 * The dialog calls ONLY the shared ReferencesMediaService — never storage
 * directly. It makes no claims about scanning or recognition: an upload
 * stores an image plus the user-provided metadata below.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { ReferencesMediaService, describeMediaError, type UploadStage } from './referencesMediaService';
import {
  MAX_DIMENSION_PX,
  MAX_FILE_SIZE_BYTES,
  MIN_DIMENSION_PX,
  readImageDimensions,
  validateDimensions,
  validateFileMetadata,
  readFileHead,
} from './validateUpload';
import type { ReferenceTargetType } from './storagePaths';

const HELP_TEXT =
  'JPEG, PNG or WebP · up to 10 MB · between 256×256 and 8192×8192 pixels.';

const RIGHTS_SENTENCE = 'I confirm that I have the right to upload and use this reference in LockFlow.';

const STAGE_LABEL: Record<UploadStage, string> = {
  validating: 'Checking the file…',
  requesting: 'Reserving a private upload slot…',
  transferring: 'Uploading…',
  complete: 'Finishing up…',
};

interface PendingFileMeta {
  file: File;
  safeFilename: string;
  width: number;
  height: number;
}

export interface ReferenceUploadDialogProps {
  open: boolean;
  onClose: () => void;
  service: ReferencesMediaService;
  targetType: ReferenceTargetType;
  /** The draft version receiving the upload. */
  versionId: string;
  /** The surface's reference-type options (domain enum values). */
  typeOptions: Array<{ value: string; label: string }>;
  defaultType?: string;
  /** Called after a successful upload so the parent refreshes the list. */
  onUploaded: () => void;
}

export function ReferenceUploadDialog({
  open,
  onClose,
  service,
  targetType,
  versionId,
  typeOptions,
  defaultType,
  onUploaded,
}: ReferenceUploadDialogProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [fileMeta, setFileMeta] = useState<PendingFileMeta | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [referenceType, setReferenceType] = useState(defaultType ?? typeOptions[0]?.value ?? 'other');
  const [caption, setCaption] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  // Reset transient state whenever the dialog opens for a new round.
  useEffect(() => {
    if (open) {
      setFileMeta(null);
      setPreflightError(null);
      setUploadError(null);
      setStage(null);
      setCaption('');
      setRightsConfirmed(false);
      setReferenceType(defaultType ?? typeOptions[0]?.value ?? 'other');
    }
  }, [open, defaultType, typeOptions]);

  const inspectFile = useCallback(async (file: File) => {
    setPreflightError(null);
    setFileMeta(null);
    try {
      const head = await readFileHead(file);
      const meta = validateFileMetadata(
        { name: file.name, size: file.size, type: file.type },
        head,
      );
      const dimensions = await readImageDimensions(file);
      if (!dimensions) {
        throw new Error('This environment cannot read image dimensions — try a modern browser.');
      }
      validateDimensions(dimensions);
      setFileMeta({ file, safeFilename: meta.safeFilename, width: dimensions.width, height: dimensions.height });
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : 'That file cannot be used.');
    }
  }, []);

  async function handleSubmit() {
    if (!fileMeta || !rightsConfirmed || stage !== null) return;
    setUploadError(null);
    try {
      await service.uploadReference(
        {
          targetType,
          versionId,
          referenceType,
          caption: caption.trim(),
          file: fileMeta.file,
          rightsConfirmed,
        },
        { onStageChange: setStage },
      );
      toast({
        title: 'Reference uploaded',
        description: `${fileMeta.safeFilename} is stored privately and visible to this workspace only.`,
        tone: 'success',
      });
      setStage(null);
      onUploaded();
      onClose();
    } catch (error) {
      setStage(null);
      setUploadError(describeMediaError(error));
    }
  }

  const busy = stage !== null;
  const canSubmit = Boolean(fileMeta) && rightsConfirmed && !busy;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Upload reference"
      description="Stored privately — visible to this workspace only, attached to this draft version."
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {busy ? 'Uploading…' : 'Upload reference'}
          </Button>
        </>
      }
    >
      <div className="lf-section" style={{ gap: 'var(--lf-space-3)' }}>
        <div
          className={`lf-uploaddrop${dropActive ? ' lf-uploaddrop--active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped && !busy) void inspectFile(dropped);
          }}
        >
          {fileMeta ? (
            <div className="lf-uploadfile">
              <strong>{fileMeta.safeFilename}</strong>
              <span className="lf-tile__description">
                {(fileMeta.file.size / (1024 * 1024)).toFixed(1)} MB · {fileMeta.width}×{fileMeta.height} px
              </span>
              <span className={`lf-uploadchip lf-uploadchip--${stage ? 'pending' : 'ready'}`}>
                {stage ? STAGE_LABEL[stage] : 'Ready to upload'}
              </span>
              {!busy ? (
                <button
                  type="button"
                  className="lf-linklike"
                  onClick={() => {
                    setFileMeta(null);
                    inputRef.current?.focus();
                  }}
                >
                  Choose a different file
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <p className="lf-tile__description" style={{ margin: 0 }}>
                Drag an image here, or
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                Choose a file
              </Button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="lf-visually-hidden"
            aria-label="Choose a reference image to upload"
            tabIndex={-1}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = ''; // allow re-choosing the same file
              if (chosen && !busy) void inspectFile(chosen);
            }}
          />
          <span className="lf-field__hint">{HELP_TEXT}</span>
        </div>

        {preflightError ? (
          <div className="lf-alertbox" role="alert">
            {preflightError}
            <div>
              <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
                Try another file
              </Button>
            </div>
          </div>
        ) : null}

        {uploadError ? (
          <div className="lf-alertbox" role="alert">
            {uploadError}
            <div>
              <Button size="sm" variant="ghost" onClick={() => void handleSubmit()} disabled={!canSubmit}>
                Retry upload
              </Button>
            </div>
          </div>
        ) : null}

        <div className="lf-sheet__section">
          <label className="lf-field__label" htmlFor="lf-refupload-type">
            Reference type
          </label>
          <select
            id="lf-refupload-type"
            className="lf-input"
            value={referenceType}
            onChange={(event) => setReferenceType(event.target.value)}
            disabled={busy}
          >
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="lf-sheet__section">
          <label className="lf-field__label" htmlFor="lf-refupload-caption">
            Caption (optional)
          </label>
          <input
            id="lf-refupload-caption"
            className="lf-input"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            disabled={busy}
            placeholder="e.g. Front label, straight-on"
          />
        </div>

        <div className="lf-sheet__section">
          <label className="lf-envlock__rights" htmlFor="lf-refupload-rights">
            <input
              id="lf-refupload-rights"
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
              disabled={busy}
            />
            <span>{RIGHTS_SENTENCE}</span>
          </label>
          <span className="lf-field__hint">
            Required. Confirmed rights are recorded with the upload for auditability. LockFlow does not
            permit deceptive likenesses or unauthorised imagery.
          </span>
        </div>
      </div>
    </Modal>
  );
}

export { MAX_FILE_SIZE_BYTES, MIN_DIMENSION_PX, MAX_DIMENSION_PX };
