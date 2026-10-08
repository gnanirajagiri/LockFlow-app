/**
 * Overview tab — Stage-5 S30: three-column body under the profile hero —
 * Locked traits (from the active version's Character Sheet), Fine details
 * chips + Style signature, and "Environments used with X" (derived from job
 * provenance, never a default) — followed by the Recent outputs strip.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { LockIcon } from '../../components/icons';
import { ModelsService } from '../../services/modelsService';
import { useUsageSummary } from '../usage/useUsageSummary';
import type { CharacterSheetRecord, ModelVersionRecord } from '../../domain/models';

interface OverviewTabProps {
  modelId: string;
  modelName: string;
  activeVersion: ModelVersionRecord | null;
  basePath: string;
  service: ModelsService;
}

const TRAIT_ROWS: Array<{ group: 'faceFeatures' | 'complexion' | 'hairIdentity' | 'bodyProportions'; key: string; label: string }> = [
  { group: 'faceFeatures', key: 'faceShape', label: 'Face' },
  { group: 'complexion', key: 'skinTone', label: 'Skin tone' },
  { group: 'faceFeatures', key: 'eyes', label: 'Eyes' },
  { group: 'hairIdentity', key: 'hair', label: 'Hair' },
  { group: 'bodyProportions', key: 'body', label: 'Body' },
];

function traitText(sheet: CharacterSheetRecord, group: string, key: string): string | null {
  const source = sheet[group as keyof CharacterSheetRecord] as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') return null;
  const raw = source[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

export function OverviewTab({ modelId, modelName, activeVersion, basePath, service }: OverviewTabProps) {
  const locked = activeVersion?.status === 'locked';
  const usage = useUsageSummary('model', modelId);
  const [sheet, setSheet] = useState<CharacterSheetRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeVersion) {
      setSheet(null);
      return;
    }
    void service
      .getCharacterSheet(activeVersion.id, SEED_WORKSPACE_ID_FALLBACK)
      .then((record) => {
        if (!cancelled) setSheet(record);
      })
      .catch(() => {
        if (!cancelled) setSheet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeVersion, service]);

  const traitRows = sheet
    ? TRAIT_ROWS.map((row) => ({ label: row.label, value: traitText(sheet, row.group, row.key) })).filter(
        (row): row is { label: string; value: string } => row.value !== null,
      )
    : [];

  const detailChips = sheet
    ? Object.values(sheet.distinctiveDetails ?? {}).filter(
        (value): value is string => typeof value === 'string' && value.trim() !== '',
      )
    : [];

  const styleChips = sheet
    ? Object.values(sheet.lockRules ?? {}).filter(
        (value): value is string => typeof value === 'string' && value.trim() !== '' && value.toLowerCase() !== 'none',
      )
    : [];

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <div className="lf-mprofile__columns">
        <Card>
          <CardBody>
            <div className="lf-mprofile__panelhead">
              <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>
                Locked traits
              </h3>
              {locked && traitRows.length > 0 ? (
                <Badge tone="locked">
                  <LockIcon size={11} /> {traitRows.length} locked
                </Badge>
              ) : null}
            </div>
            {traitRows.length === 0 ? (
              <p className="lf-tile__description">
                {locked
                  ? 'Traits arrive once the Character Sheet has identity sections filled.'
                  : 'Fill the Character Sheet and lock the version to protect these traits.'}
              </p>
            ) : (
              <ul className="lf-mprofile__traits">
                {traitRows.map((row) => (
                  <li key={row.label} className="lf-mprofile__traitrow">
                    <span className="lf-mprofile__traitlabel">{row.label}</span>
                    <span className="lf-mprofile__traitvalue">{row.value}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link className="lf-mprofile__panellink" to={`${basePath}/character-sheet`}>
              View Character Sheet
            </Link>
          </CardBody>
        </Card>

        <div className="lf-mprofile__midcol">
          <Card>
            <CardBody>
              <div className="lf-mprofile__panelhead">
                <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>
                  Fine details
                </h3>
              </div>
              {detailChips.length === 0 ? (
                <p className="lf-tile__description">
                  Distinctive details from the Character Sheet appear here.
                </p>
              ) : (
                <div className="lf-mprofile__chips">
                  {detailChips.slice(0, 4).map((chip) => (
                    <span key={chip} className="lf-mprofile__chip">
                      <LockIcon size={10} /> {chip}
                    </span>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="lf-mprofile__panelhead">
                <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>
                  Style signature
                </h3>
              </div>
              <p className="lf-tile__description">Suggests only — never locks Library items.</p>
              <div className="lf-mprofile__chips">
                {styleChips.length === 0 ? (
                  <span className="lf-mprofile__chip">Natural</span>
                ) : (
                  styleChips.slice(0, 4).map((chip) => (
                    <span key={chip} className="lf-mprofile__chip">
                      {chip}
                    </span>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardBody>
            <div className="lf-mprofile__panelhead">
              <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>
                Environments used with {modelName}
              </h3>
            </div>
            <p className="lf-tile__description">
              From usage history. {modelName} has no default environment.
            </p>
            {usage === null ? null : usage.outputs.length === 0 ? (
              <p className="lf-tile__description">No jobs have used {modelName} yet.</p>
            ) : (
              <ul className="lf-envref__list">
                {usage.outputs.slice(0, 3).map((output) => (
                  <li key={output.id} className="lf-envref__item">
                    <Link to={output.path}>
                      <strong>{output.title}</strong>
                    </Link>
                    <span className="lf-tile__description">
                      Gallery · {output.status.replace(/_/g, ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <section className="lf-section" aria-label="Recent outputs">
        <div className="lf-section__header">
          <h2 className="lf-section__title">Recent outputs</h2>
          <Link className="lf-section__link" to="/gallery">
            Open Gallery →
          </Link>
        </div>
        {usage === null ? null : usage.outputs.length === 0 ? (
          <Card>
            <CardBody>
              <p className="lf-tile__description" data-testid="gallery-placeholder">
                Generated work appears in Gallery once jobs run.
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="lf-mprofile__outputs">
            {usage.outputs.slice(0, 6).map((output) => {
              const pill =
                output.status === 'ready_for_review'
                  ? 'In review'
                  : output.status === 'failed'
                    ? 'Failed'
                    : output.status === 'draft'
                      ? 'Draft'
                      : 'Export';
              return (
                <Link key={output.id} to={output.path} className="lf-mprofile__outputcard">
                  <span
                    className={`lf-mprofile__outputpill${output.status === 'failed' ? ' lf-mprofile__outputpill--failed' : ''}`}
                  >
                    {pill}
                  </span>
                  <span className="lf-mprofile__outputname">{output.title}</span>
                  <span className="lf-mprofile__outputmeta">{pill}</span>
                </Link>
              );
            })}
          </div>
        )}
        <span className="lf-versionrow__dates">
          This area shows a lightweight historical summary only — no outputs are created or
          stored here.
        </span>
      </section>
    </div>
  );
}

const SEED_WORKSPACE_ID_FALLBACK = 'ws_demo';
