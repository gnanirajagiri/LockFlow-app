/**
 * Template suggestions panel — read-only "non-binding" hints shown inside a
 * Content Studio project that was created from a Template. Suggestions are
 * never auto-converted into project inputs or version pins; the user chooses
 * (or ignores) them while selecting exact approved versions in Inputs.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { TemplatesService } from '../../services/templatesService';
import { getTemplatesRepository } from '../../data/templatesFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type { ContentProjectRecord } from '../../domain/content';
import type { ContentTemplateSuggestionRecord } from '../../domain/templates';

const TYPE_LABEL: Record<ContentTemplateSuggestionRecord['suggestionType'], string> = {
  model: 'Suggested primary model',
  environment: 'Suggested environment',
  look: 'Suggested Look',
  library_asset_category: 'Suggested Library category',
  library_asset: 'Suggested Library asset',
};

function hrefFor(suggestion: ContentTemplateSuggestionRecord): string | null {
  switch (suggestion.suggestionType) {
    case 'model':
      return suggestion.suggestedAssetId ? `/models/${suggestion.suggestedAssetId}` : null;
    case 'environment':
      return suggestion.suggestedAssetId ? `/environments/${suggestion.suggestedAssetId}` : null;
    case 'look':
      return suggestion.suggestedAssetId ? `/library/looks/${suggestion.suggestedAssetId}` : null;
    case 'library_asset':
      return suggestion.suggestedAssetId ? `/library/${suggestion.suggestedAssetId}` : null;
    default:
      return null;
  }
}

export function TemplateSuggestionsPanel({ project }: { project: ContentProjectRecord }) {
  if (!project.sourceTemplateId) return null;
  return <PanelInner key={project.id} project={project} />;
}

function PanelInner({ project }: { project: ContentProjectRecord }) {
  const service = useMemo(
    () =>
      new TemplatesService(getTemplatesRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [suggestions, setSuggestions] = useState<ContentTemplateSuggestionRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    const templateId = project.sourceTemplateId!;
    service
      .listSuggestions(templateId, SEED_CONTENT_WORKSPACE_ID)
      .then((list) => {
        if (!cancelled) {
          setSuggestions(list);
          setState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [project.sourceTemplateId, service]);

  if (state === 'error') return null;
  if (state === 'loading') {
    return (
      <Card>
        <CardBody>
          <Skeleton lines={2} />
        </CardBody>
      </Card>
    );
  }
  if (suggestions.length === 0) return null;

  return (
    <Card>
      <CardBody>
        <h3 className="lf-envpanel__heading">
          Template suggestions — choose exact approved versions to use.
        </h3>
        <p className="lf-tile__description">
          Created from template: <strong>{project.sourceTemplateName}</strong>. These hints come
          from the template and are not selections — nothing is pinned from here.
        </p>
        <ul className="lf-envref__list">
          {suggestions.map((suggestion) => {
            const href = hrefFor(suggestion);
            return (
              <li key={suggestion.id} className="lf-envref__item">
                <span className="lf-refcard__type">{TYPE_LABEL[suggestion.suggestionType]}</span>
                <span className="lf-envref__row">
                  {href ? (
                    <Link to={href}>
                      <strong>{suggestion.suggestedRole.replace(/_/g, ' ')}</strong> — view the
                      suggested item
                    </Link>
                  ) : (
                    <strong>{suggestion.suggestedRole.replace(/_/g, ' ')}</strong>
                  )}
                  <Badge tone="neutral">Suggestion only</Badge>
                </span>
                {suggestion.compatibilityNotes ? (
                  <span className="lf-tile__description">{suggestion.compatibilityNotes}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="lf-lockedbanner__copy" style={{ marginTop: 'var(--lf-space-2)' }}>
          Suggestion only — exact approved versions are selected and pinned in Content Studio.
        </p>
      </CardBody>
    </Card>
  );
}
