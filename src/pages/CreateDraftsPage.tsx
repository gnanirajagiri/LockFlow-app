/**
 * /create/drafts — "Saved drafts & review" (Stage-5 S09).
 *
 * Everything started but not locked: model drafts, model-version drafts,
 * environment drafts and content plans. Tab counts (All / Models /
 * Environments / Needs review), then a table with a cover thumb, name,
 * type, builder step reached, last-edited time and Resume action.
 * Drafts are never deletable in demo mode — the Delete action asks for
 * confirmation and is refused by the service (LockFlow keeps history).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { AlertIcon, CloseIcon, LockIcon } from '../components/icons';
import { useCreateOverviewData } from '../features/create/useCreateOverviewData';

type DraftTab = 'all' | 'models' | 'environments' | 'review';

interface DraftRow {
  id: string;
  to: string;
  name: string;
  type: string;
  typeGroup: 'models' | 'environments';
  step: string;
  stepIndex: number;
  stepTotal: number;
  editedAt: string;
  cover: string;
  needsReview: boolean;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? 'Yesterday' : `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

export function CreateDraftsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { loading, models, modelVersions, environments, environmentVersions, projects } =
    useCreateOverviewData();
  const [tab, setTab] = useState<DraftTab>('all');
  const [deleteTarget, setDeleteTarget] = useState<DraftRow | null>(null);

  const rows = useMemo<DraftRow[]>(() => {
    const list: DraftRow[] = [];
    for (const model of models) {
      const drafts = (modelVersions[model.id] ?? []).filter((v) => v.status === 'draft');
      const cover = model.coverImagePath ?? '/placeholders/gallery/gallery_morning_routine_variant-thumb.svg';
      for (const draft of drafts) {
        list.push({
          id: `mv-${draft.id}`,
          to: `/models/${model.id}/character-sheet?version=${draft.id}`,
          name: `${model.name} v${draft.versionNumber}`,
          type: 'Model version',
          typeGroup: 'models',
          step: 'Character Sheet',
          stepIndex: 5,
          stepTotal: 6,
          editedAt: draft.updatedAt,
          cover: draft.coverImagePath ?? cover,
          needsReview: false,
        });
      }
      if (model.status === 'draft') {
        list.push({
          id: `m-${model.id}`,
          to: `/models/${model.id}`,
          name: model.name,
          type: 'Model',
          typeGroup: 'models',
          step: 'Character Sheet',
          stepIndex: 5,
          stepTotal: 6,
          editedAt: model.updatedAt,
          cover,
          needsReview: false,
        });
      }
    }
    for (const environment of environments) {
      const drafts = (environmentVersions[environment.id] ?? []).filter((v) => v.status === 'draft');
      const cover = environment.coverImagePath ?? '/placeholders/gallery/gallery_morning_vanity_setup-thumb.svg';
      for (const draft of drafts) {
        list.push({
          id: `ev-${draft.id}`,
          to: `/environments/${environment.id}/builder`,
          name: `${environment.name} v${draft.versionNumber}`,
          type: 'Environment',
          typeGroup: 'environments',
          step: 'Anchors & rooms',
          stepIndex: 3,
          stepTotal: 5,
          editedAt: draft.updatedAt,
          cover: draft.coverImagePath ?? cover,
          needsReview: true,
        });
      }
    }
    for (const project of projects) {
      list.push({
        id: `p-${project.project.id}`,
        to: `/content-studio/${project.project.id}`,
        name: project.project.name,
        type: 'Content set · Plan',
        typeGroup: 'environments',
        step: 'Storyboard',
        stepIndex: 2,
        stepTotal: 5,
        editedAt: project.project.updatedAt,
        cover: '/placeholders/gallery/gallery_routine_wrapup_story-thumb.svg',
        needsReview: false,
      });
    }
    return list.sort((a, b) => (a.editedAt < b.editedAt ? 1 : -1));
  }, [models, modelVersions, environments, environmentVersions, projects]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      models: rows.filter((r) => r.typeGroup === 'models').length,
      environments: rows.filter((r) => r.typeGroup === 'environments').length,
      review: rows.filter((r) => r.needsReview).length,
    }),
    [rows],
  );

  const filtered = rows.filter((row) => {
    if (tab === 'all') return true;
    if (tab === 'review') return row.needsReview;
    return row.typeGroup === tab;
  });

  function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    // LockFlow keeps history: drafts are archived-by-design, never destroyed.
    setDeleteTarget(null);
    toast({
      title: 'Drafts are never deleted',
      description: 'LockFlow keeps every draft so nothing you started is lost. Archive instead when this ships.',
      tone: 'info',
    });
  }

  return (
    <div className="lf-page">
      <PageHeader
        title="Saved drafts & review"
        description="Everything you started but haven't locked yet."
      />

      <div className="lf-drafttabs" role="tablist" aria-label="Draft filters">
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'models', label: 'Models' },
            { key: 'environments', label: 'Environments' },
            { key: 'review', label: 'Needs review' },
          ] as Array<{ key: DraftTab; label: string }>
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`lf-drafttabs__tab${tab === t.key ? ' lf-drafttabs__tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="lf-drafttabs__count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <Card>
          <CardBody>
            <Skeleton lines={4} />
          </CardBody>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={tab === 'review' ? 'Nothing needs review' : 'No drafts here'}
          description="Start a model, environment or content plan and it will be saved here automatically."
          actions={
            <Button variant="primary" onClick={() => navigate('/create')}>
              Start something new
            </Button>
          }
        />
      ) : (
        <Card>
          <CardBody flush>
            <table className="lf-table lf-drafttable">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Step reached</th>
                  <th scope="col">Last edited</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="lf-drafttable__namecell">
                        <span className="lf-drafttable__thumb" aria-hidden="true">
                          <img src={row.cover} alt="" loading="lazy" />
                        </span>
                        <span className="lf-drafttable__name">
                          {row.name}
                          {row.needsReview ? (
                            <span className="lf-drafttable__reviewpill">
                              <AlertIcon size={11} /> Needs review
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </td>
                    <td className="lf-drafttable__muted">{row.type}</td>
                    <td>
                      {row.step} ({row.stepIndex} of {row.stepTotal})
                    </td>
                    <td className="lf-drafttable__muted">{relativeTime(row.editedAt)}</td>
                    <td>
                      <span className="lf-drafttable__actions">
                        <Button size="sm" variant="primary" onClick={() => navigate(row.to)}>
                          Resume
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={<CloseIcon size={12} />}
                          onClick={() => setDeleteTarget(row)}
                        >
                          Delete draft
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete draft'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDeleteConfirmed}>
              Delete draft
            </Button>
          </div>
        }
      >
        <p className="lf-tile__description">
          <LockIcon size={12} /> LockFlow never destroys work-in-progress: drafts are kept so you
          can always resume. Deletion arrives with archive support.
        </p>
      </Modal>
    </div>
  );
}
