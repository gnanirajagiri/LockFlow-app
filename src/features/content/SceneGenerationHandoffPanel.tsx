/**
 * Prompt 34 — per-scene generation handoff panel. Shows the scene's
 * version-pinned inputs (model / environment / Library assets), the safe
 * readiness checklist from the server, and the explicit generation handoff
 * controls (image / video / story).
 *
 * Calls ONLY the StoryboardService + real generation services (prompts 27/28)
 * through the bridge in storyboardBridge.ts. It never mutates locked sources;
 * generation results flow to Gallery through the existing ingestion. The
 * prompt bar stays available above (storyboard direction) and can never
 * bypass the Character Sheet baseline — validation is server-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { LockIcon, SparkIcon } from '../../components/icons';
import { SEED_CONTENT_WORKSPACE_ID as SEED_WS } from '../../mock/contentSeed';
import { getStoryboardBridge } from './storyboardBridge';
import type {
  SceneGenerationType,
} from '../../studio/storyboardWorkflow';

const KIND_LABELS: Record<string, string> = {
  model_version: 'Model',
  environment_version: 'Environment',
  library_asset: 'Library asset',
};

interface SceneBindingView {
  id: string;
  kind: string;
  refId: string;
  label: string;
  role: string | null;
}

export interface SceneGenerationHandoffPanelProps {
  sceneId: string;
  sceneTitle: string;
  scenePurpose: string | null;
  canHandoff: boolean;
}

export function SceneGenerationHandoffPanel({
  sceneId,
  sceneTitle,
  scenePurpose,
  canHandoff,
}: SceneGenerationHandoffPanelProps) {
  const { toast } = useToast();
  const bridge = getStoryboardBridge();
  const [bindings, setBindings] = useState<SceneBindingView[] | null>(null);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [type, setType] = useState<Exclude<SceneGenerationType, 'content_set'>>('image');
  const [busy, setBusy] = useState(false);
  const [lastHandoff, setLastHandoff] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await bridge.listSceneBindings(SEED_WS, sceneId);
      setBindings(rows);
      const check = await bridge.validateSceneForGeneration(SEED_WS, sceneId, type);
      setBlockers(check.ready ? [] : check.blockers);
    } catch {
      setBindings([]);
      setBlockers(['Could not evaluate this scene right now.']);
    }
  }, [bridge, sceneId, type]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleGenerate() {
    if (busy || !canHandoff) return;
    setBusy(true);
    try {
      const result = await bridge.submitSceneGeneration(SEED_WS, sceneId, type);
      if (!result.eligible) {
        toast({
          title: 'Scene is not ready for generation',
          description: result.blocking[0] ?? 'Resolve the blockers first.',
          tone: 'error',
        });
        await refresh();
        return;
      }
      setLastHandoff(result.jobId);
      toast({
        title: type === 'story' ? 'Story generation submitted' : `${type === 'image' ? 'Image' : 'Video'} generation submitted`,
        description: 'Outputs will appear in Gallery when ingestion completes — they never publish automatically.',
        tone: 'success',
      });
    } catch (err) {
      toast({
        title: 'Generation handoff blocked',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  const hasBindings = (bindings?.length ?? 0) > 0;
  const isReady = blockers !== null && blockers.length === 0 && hasBindings;

  return (
    <section className="lf-sheet__section" aria-label={`Generation handoff for scene ${sceneTitle}`}>
      <div className="lf-envcard__badges">
        <h4 className="lf-envpanel__heading" style={{ margin: 0 }}>
          <SparkIcon size={14} /> Generation handoff
        </h4>
        {isReady ? (
          <Badge tone="success">ready</Badge>
        ) : hasBindings ? (
          <Badge tone="warning">not ready</Badge>
        ) : (
          <Badge tone="neutral">no inputs pinned</Badge>
        )}
      </div>

      {bindings === null ? (
        <p className="lf-tile__description">Checking pinned inputs…</p>
      ) : hasBindings ? (
        <ol className="lf-library__lookitems" style={{ margin: 'var(--lf-space-2) 0' }}>
          {bindings.map((binding) => (
            <li key={binding.id} className="lf-library__lookitem">
              <span className="lf-library__lookitemnum" aria-hidden="true">
                <LockIcon size={12} />
              </span>
              <span className="lf-library__lookitembody">
                <strong>{KIND_LABELS[binding.kind] ?? binding.kind}</strong>
                <span className="lf-tile__description">
                  {binding.label}
                  {binding.role ? ` — ${binding.role}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="lf-tile__description">
          No locked inputs pinned yet. Pin a model or environment version (with its Character Sheet baseline) from the
          Inputs tab before handing this scene off.
        </p>
      )}

      {blockers && blockers.length > 0 ? (
        <ul className="lf-library__warning" style={{ margin: 'var(--lf-space-2) 0' }}>
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      {canHandoff ? (
        <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
          <select
            className="lf-input"
            aria-label="Generation output type"
            value={type}
            onChange={(event) => setType(event.target.value as Exclude<SceneGenerationType, 'content_set'>)}
            disabled={busy}
            style={{ maxWidth: 160 }}
          >
            <option value="image">Image</option>
            <option value="video">Video clip</option>
            <option value="story">Story (grouped frames)</option>
          </select>
          <Button variant="primary" size="sm" disabled={busy || !hasBindings} onClick={() => void handleGenerate()}>
            {busy ? 'Handing off…' : 'Hand off to generation'}
          </Button>
          {lastHandoff ? (
            <Badge tone="info">job {lastHandoff.slice(0, 8)}…</Badge>
          ) : null}
        </div>
      ) : (
        <p className="lf-tile__description">
          Handoff unlocks when the plan is back in draft (existing published plans stay read-only).
        </p>
      )}
      {scenePurpose ? (
        <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-2)' }}>
          Snapshot captures this scene&apos;s purpose, beats and pinned versions at handoff time.
        </p>
      ) : null}
    </section>
  );
}
