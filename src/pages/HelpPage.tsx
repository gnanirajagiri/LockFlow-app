import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardBody } from '../components/ui/Card';
import { LockIcon } from '../components/icons';

const GLOSSARY = [
  {
    term: 'Locking',
    definition:
      'Freezing a specific version of a model or environment so it becomes immutable and referenceable by content jobs.',
  },
  {
    term: 'Versioning',
    definition:
      'Every change in the Model Builder or Environment Builder records a new version — jobs always reference exact versions.',
  },
  {
    term: 'Gallery',
    definition:
      'Generated content jobs and outputs only: queued, rendering, drafts, review-ready work and exports.',
  },
  {
    term: 'Library',
    definition:
      'One unified reusable-asset system for products, props, wardrobe, saved Looks, scenes and brand assets.',
  },
];

export function HelpPage() {
  return (
    <div className="lf-page">
      <PageHeader
        title="Help"
        description="How LockFlow thinks about continuity — and what each area of the app is for."
      />
      <div className="lf-tilegrid">
        {GLOSSARY.map((entry) => (
          <Card key={entry.term}>
            <CardBody>
              <div className="lf-tile__title">
                <span className="lf-tile__title-icon">
                  <LockIcon size={16} />
                </span>
                {entry.term}
              </div>
              <p className="lf-tile__description">{entry.definition}</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
