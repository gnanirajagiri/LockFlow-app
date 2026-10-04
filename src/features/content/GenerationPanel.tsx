/**
 * Generation panel — the job tab's generation surface (image generation
 * milestone). Shows provider configuration state, the readiness checklist
 * with a clear reason for every blocking issue, requires the explicit
 * rights/allowance acknowledgement before submission, displays live run
 * status and offers safe retry only for failed runs.
 *
 * This component calls ONLY the GenerationService (never a provider adapter,
 * never Storage). Pins are never editable here after submission.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { useToast } from '../../components/ui/Toast';
import { isDemoMode } from '../../lib/env';
import { createGenerationService, DEMO_GENERATION_CONFIG } from '../../generation/factory';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import { LockIcon } from '../../components/icons';
import type { ContentJobPinRecord } from '../../domain/content';

const ACKNOWLEDGEMENT =
  'I confirm I have rights to use the selected references and understand this will use my workspace generation allowance.';

/** Prompt 27 — locked-input labels for the reviewable baseline summary. */
const PIN_TYPE_LABELS: Record<string, string> = {
  model_version: 'Model (locked version)',
  environment_version: 'Environment (locked version)',
  library_asset_version: 'Library asset',
  look_version: 'Look',
  model: 'Model',
  environment: 'Environment',
  library_asset: 'Library asset',
  look: 'Look',
};

function pinLabel(pin: ContentJobPinRecord): string {
  const details = pin.resolvedDetails as {
    modelName?: string;
    environmentName?: string;
    assetName?: string;
    versionNumber?: number;
  };
  const name = details.modelName ?? details.environmentName ?? details.assetName ?? pin.sourceRecordId;
  const version = details.versionNumber ? ` v${details.versionNumber}` : '';
  return `${PIN_TYPE_LABELS[pin.pinType] ?? pin.pinType}: ${name}${version}`;
}

const STATUS_LABEL: Record<string, string> = {
  created: 'Preparing',
  submitted: 'Queued',
  queued: 'Queued',
  processing: 'Generating',
  review: 'In review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  draft: 'Draft',
};

export interface GenerationPanelProps {
  jobId: string | null;
  jobStatus: string;
  requestedVariants: number;
  pins: ContentJobPinRecord[] | null;
  onSubmitted: () => void;
}

export function GenerationPanel({ jobId, jobStatus, requestedVariants, pins, onSubmitted }: GenerationPanelProps) {
  const { toast } = useToast();
  const { service, repo } = useMemo(() => createGenerationService(), []);

  const [config, setConfig] = useState(DEMO_GENERATION_CONFIG);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [outputsReady, setOutputsReady] = useState(0);
  const [blocking, setBlocking] = useState<string[]>([]);
  // Prompt 27 — prompt-bar input and the reviewable normalized intent.
  const [promptText, setPromptText] = useState('');
  const [showPromptReview, setShowPromptReview] = useState(false);
  const [variantBusy, setVariantBusy] = useState(false);

  useEffect(() => {
    void repo.getConfig().then(setConfig).catch(() => undefined);
  }, [repo]);

  const refreshStatus = useCallback(async () => {
    if (!jobId) {
      setRunStatus(null);
      return;
    }
    try {
      const status = await service.getRunStatus(jobId, SEED_CONTENT_WORKSPACE_ID);
      setRunStatus(status.run?.status ?? null);
      setOutputsReady(status.outputsReady);
    } catch {
      setRunStatus(null);
    }
  }, [jobId, service]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, jobStatus]);

  // Demo mode: the fake provider completes synchronously during submit, so
  // polling is unnecessary; real deployments poll while queued/processing.
  const activeStatus = runStatus ?? (jobStatus === 'draft' ? null : STATUS_LABEL[jobStatus] ?? jobStatus);
  const isRunning = ['created', 'submitted', 'queued', 'processing'].includes(runStatus ?? '');
  const isFailed = runStatus === 'failed' || jobStatus === 'failed';
  const isDraftJob = jobStatus === 'draft' && !isRunning && runStatus !== 'completed';
  // Terminal display: a completed run leaves the job in `review` (outputs
  // await human review in Gallery) — show "In review" in both cases.
  const completedInReview = runStatus === 'completed' || jobStatus === 'review' || jobStatus === 'completed';

  async function handleGenerate() {
    if (!jobId || submitting) return;
    setSubmitting(true);
    try {
      // Demo mode resolves the checklist client-side (mock repos are local);
      // the server RPCs re-verify everything authoritatively in real mode.
      const result = await service.submitImageGeneration(jobId, SEED_CONTENT_WORKSPACE_ID, 'demo-user', {
        pins: (pins ?? []).map((pin) => ({
          pinType: pin.pinType as 'model' | 'environment' | 'library_asset' | 'look',
          sourceRecordId: pin.sourceRecordId,
          sourceVersionId: pin.sourceVersionId,
          resolvedDetails: pin.resolvedDetails as Record<string, never>,
        })),
        references: [],
        assets: {},
        prompt: promptText.trim() || 'LockFlow demo generation run',
        // Prompt 27: model pins require the Character Sheet identity baseline.
        requireIdentityBaseline: Object.fromEntries(
          (pins ?? [])
            .filter((pin) => pin.pinType === 'model_version')
            .map((pin) => [pin.sourceRecordId, true]),
        ),
      });
      if (!result.eligible) {
        setBlocking(result.blocking);
        toast({ title: 'Job is not eligible for generation', description: result.blocking[0], tone: 'error' });
        return;
      }
      setBlocking([]);
      toast({
        title: 'Generation submitted',
        description: 'Outputs will appear in Gallery when ingestion completes.',
        tone: 'success',
      });
      await refreshStatus();
      onSubmitted();
    } catch (error) {
      toast({
        title: 'Could not start generation',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry() {
    if (!jobId || submitting) return;
    setSubmitting(true);
    try {
      const result = await service.retryImageGeneration(jobId, SEED_CONTENT_WORKSPACE_ID, 'demo-user', {
        pins: (pins ?? []).map((pin) => ({
          pinType: pin.pinType as 'model' | 'environment' | 'library_asset' | 'look',
          sourceRecordId: pin.sourceRecordId,
          sourceVersionId: pin.sourceVersionId,
          resolvedDetails: pin.resolvedDetails as Record<string, never>,
        })),
        references: [],
        assets: {},
        prompt: 'LockFlow demo generation run',
      });
      if (!result.eligible) {
        setBlocking(result.blocking);
        return;
      }
      setBlocking([]);
      await refreshStatus();
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  const providerConfigured = config.imageGenerationEnabled && config.providerName !== 'none';
  const modelPinCount = (pins ?? []).filter((pin) => pin.pinType === 'model_version').length;

  /** Prompt 27 — spawns a variant generation from the completed run. */
  async function handleVariant() {
    if (!jobId || variantBusy) return;
    setVariantBusy(true);
    try {
      const result = await service.createImageVariantJob(jobId, SEED_CONTENT_WORKSPACE_ID, 'demo-user', {});
      if (!result.eligible) {
        toast({ title: 'Variant blocked', description: result.blocking[0], tone: 'error' });
        return;
      }
      toast({
        title: 'Variant generation started',
        description: 'The variant inherits the original locked inputs and appears in Gallery when ready.',
        tone: 'success',
      });
      onSubmitted();
    } catch (error) {
      toast({
        title: 'Could not create the variant',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setVariantBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">Generate images</h3>

        <div className="lf-envcard__badges" style={{ marginBottom: 'var(--lf-space-3)' }}>
          <Badge tone={providerConfigured ? 'success' : 'neutral'}>
            {providerConfigured ? `Provider: ${config.providerName}` : 'No provider configured'}
          </Badge>
          <Badge tone="neutral">≤ {config.imageMaxOutputsPerJob} outputs per job</Badge>
          <Badge tone="neutral">This run: {requestedVariants} image{requestedVariants === 1 ? '' : 's'}</Badge>
        </div>

        {!providerConfigured ? (
          <p className="lf-tile__description">
            Image generation is fail-closed: no production provider is configured for this deployment.
            {isDemoMode ? ' Demo mode uses the development fake provider with clearly marked placeholder outputs.' : ''}
          </p>
        ) : null}

        {activeStatus && !isDraftJob ? (
          <div className="lf-envref__state" style={{ marginBottom: 'var(--lf-space-3)' }}>
            <Badge tone={isFailed ? 'danger' : completedInReview ? 'success' : 'primary'} dot>
              {completedInReview ? 'In review' : STATUS_LABEL[runStatus ?? jobStatus] ?? runStatus ?? jobStatus}
            </Badge>
            {outputsReady > 0 ? (
              <span className="lf-tile__description">{outputsReady} output(s) ingested — see Gallery.</span>
            ) : null}
          </div>
        ) : null}

        {blocking.length > 0 ? (
          <ul className="lf-alertbox" role="alert" style={{ margin: 0, paddingLeft: '1.2em' }}>
            {blocking.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        {isDraftJob && providerConfigured ? (
          <>
            {/* Prompt 27 — prompt bar: simple-language intent for the run. */}
            <div className="lf-sheet__section" style={{ marginBottom: 'var(--lf-space-3)' }}>
              <label className="lf-field__label" htmlFor="lf-gen-prompt">
                Prompt
              </label>
              <textarea
                id="lf-gen-prompt"
                className="lf-textarea"
                placeholder="Describe the image — subject, setting, mood…"
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
              />
              {promptText.trim().length > 0 ? (
                <button
                  type="button"
                  className="lf-linklike"
                  onClick={() => setShowPromptReview((open) => !open)}
                >
                  {showPromptReview ? 'Hide normalized intent' : 'Review normalized intent'}
                </button>
              ) : null}
              {showPromptReview && promptText.trim().length > 0 ? (
                <p className="lf-field__hint">
                  The prompt is kept verbatim and normalized with deterministic, auditable rules
                  (subject/setting/lighting/mood extraction, aspect ratio and count clamp) before the
                  provider call. The transformation record is stored with the run.
                </p>
              ) : null}
            </div>

            {/* Prompt 27 — reviewable locked-input baseline. */}
            <div className="lf-sheet__section" style={{ marginBottom: 'var(--lf-space-3)' }}>
              <h4 style={{ margin: '0 0 var(--lf-space-2)' }}>Locked inputs for this run</h4>
              {(pins ?? []).length === 0 ? (
                <p className="lf-tile__description">
                  No locked inputs pinned yet — add model, environment or asset pins on the Inputs tab.
                </p>
              ) : (
                <ul className="lf-sheet__trait-list" style={{ margin: 0 }}>
                  {(pins ?? []).map((pin) => (
                    <li key={pin.id} className="lf-sheet__trait-row">
                      <span className="lf-sheet__trait-key">{PIN_TYPE_LABELS[pin.pinType] ?? pin.pinType}</span>
                      <span className="lf-sheet__trait-value">{pinLabel(pin)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {modelPinCount > 0 ? (
                <p className="lf-field__hint">
                  <LockIcon size={12} /> Model pins are generated under their Character Sheet identity
                  baseline — protected traits are enforced before submission.
                </p>
              ) : null}
            </div>

            <label className="lf-envlock__rights">
              <input
                id="lf-gen-ack"
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>{ACKNOWLEDGEMENT}</span>
            </label>
            <div className="lf-dialogactions" style={{ justifyContent: 'flex-start', marginTop: 'var(--lf-space-3)' }}>
              <Button
                variant="primary"
                disabled={!acknowledged || submitting || (pins?.length ?? 0) === 0}
                onClick={() => void handleGenerate()}
              >
                {submitting ? 'Submitting…' : `Generate images (${requestedVariants})`}
              </Button>
            </div>
          </>
        ) : null}

        {isFailed && !isRunning ? (
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="secondary" onClick={() => void handleRetry()} disabled={submitting}>
              {submitting ? 'Retrying…' : 'Retry failed run'}
            </Button>
          </div>
        ) : null}

        {/* Prompt 27 — variant generation from a completed run. */}
        {completedInReview && !isRunning ? (
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            <Button
              variant="secondary"
              disabled={variantBusy}
              onClick={() => void handleVariant()}
            >
              {variantBusy ? 'Creating variant…' : 'Generate variant (inherits locked inputs)'}
            </Button>
          </div>
        ) : null}

        <p className="lf-library__note">
          Outputs are private, workspace-scoped media ingested into Gallery as ready_for_review — never
          added to the Library automatically.
        </p>
      </CardBody>
    </Card>
  );
}
