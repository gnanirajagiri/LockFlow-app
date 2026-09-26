import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LibraryIcon, ModelIcon, StudioIcon } from '../components/icons';

const ENTRY_POINTS = [
  {
    to: '/models',
    icon: <ModelIcon size={20} />,
    title: 'New model',
    body: 'Open the Model Builder to compose a reusable model, version it and lock it before use in jobs.',
    badge: 'Model Builder',
  },
  {
    to: '/studio',
    icon: <StudioIcon size={20} />,
    title: 'New environment',
    body: 'Open the Environment Builder — a separate system from models with independent locks and versions.',
    badge: 'Environment Builder',
  },
  {
    to: '/library',
    icon: <LibraryIcon size={20} />,
    title: 'Add to Library',
    body: 'Register products, props, wardrobe, saved Looks, scenes or brand assets for reuse.',
    badge: 'Library',
  },
] as const;

export function CreatePage() {
  const navigate = useNavigate();

  return (
    <div className="lf-page">
      <PageHeader
        title="Create"
        description="Everything starts reusable: pick a builder, version your work, lock it, then reference the locked version in content jobs."
      />
      <div className="lf-tilegrid">
        {ENTRY_POINTS.map((entry) => (
          <Card key={entry.title} interactive onClick={() => navigate(entry.to)}>
            <CardBody>
              <div className="lf-quicklink__body">
                <span className="lf-quicklink__icon">{entry.icon}</span>
                <span className="lf-quicklink__title">{entry.title}</span>
                <span className="lf-quicklink__description">{entry.body}</span>
                <span className="lf-tile__meta">
                  <Badge tone="primary">{entry.badge}</Badge>
                </span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
