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
import type { ContentJobPinRecord } from '../../domain/content';

const ACKNOWLEDGEMENT =
  'I confirm I have rights to use the selected references and understand this will use my workspace generation allowance.';

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
        prompt: 'LockFlow demo generation run',
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

        <p className="lf-library__note">
          Outputs are private, workspace-scoped media ingested into Gallery as ready_for_review — never
          added to the Library automatically.
        </p>
      </CardBody>
    </Card>
  );
}
