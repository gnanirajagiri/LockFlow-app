import { useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Tabs } from '../components/ui/Tabs';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { LibraryIcon, ModelIcon, SparkIcon, StudioIcon } from '../components/icons';
import { MOCK_WORKSPACE } from '../mock/workspace';

const CONTINUITY = [
  {
    icon: <ModelIcon size={20} />,
    title: 'Models',
    body: 'Reusable models with independent versions and locks, managed in the Model Builder.',
    badges: ['Versioned', 'Lockable'],
  },
  {
    icon: <StudioIcon size={20} />,
    title: 'Environments',
    body: 'Scene environments are a separate system from models, with their own locks and versions.',
    badges: ['Independent'],
  },
  {
    icon: <LibraryIcon size={20} />,
    title: 'Library',
    body: 'One unified reusable-asset system — products, props, wardrobe, saved Looks, scenes and brand assets.',
    badges: ['Unified'],
  },
] as const;

export function HomePage() {
  const { toast } = useToast();
  const [demoModalOpen, setDemoModalOpen] = useState(false);

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow={MOCK_WORKSPACE.name}
        title="Home"
        description="Continuity first: reusable models, environments and assets are versioned and independently locked before use in content jobs."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDemoModalOpen(true)}>
              Shell demo
            </Button>
            <Button variant="primary" leftIcon={<SparkIcon size={16} />}>
              Start creating
            </Button>
          </>
        }
      />

      <section className="lf-section" aria-labelledby="home-continuity">
        <div className="lf-section__header">
          <h2 className="lf-section__title" id="home-continuity">
            How LockFlow works
          </h2>
        </div>
        <div className="lf-tilegrid">
          {CONTINUITY.map((item) => (
            <Card key={item.title}>
              <CardBody>
                <div className="lf-quicklink__body">
                  <span className="lf-quicklink__icon">{item.icon}</span>
                  <span className="lf-quicklink__title">{item.title}</span>
                  <span className="lf-quicklink__description">{item.body}</span>
                  <span className="lf-tile__meta">
                    {item.badges.map((badge) => (
                      <Badge key={badge} tone="primary">
                        {badge}
                      </Badge>
                    ))}
                  </span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section className="lf-section" aria-labelledby="home-recent">
        <div className="lf-section__header">
          <h2 className="lf-section__title" id="home-recent">
            Jump back in
          </h2>
          <span className="lf-section__hint">
            Recent activity appears here once data features land.
          </span>
        </div>
        <Card>
          <CardBody>
            <div style={{ display: 'grid', gap: 'var(--lf-space-3)', maxWidth: 420 }}>
              <Skeleton variant="title" />
              <Skeleton lines={2} />
            </div>
          </CardBody>
        </Card>
      </section>

      <Modal
        open={demoModalOpen}
        onClose={() => setDemoModalOpen(false)}
        title="Shell demo"
        description="This dialog exercises the Modal, Tabs and Toast foundation components."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDemoModalOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDemoModalOpen(false);
                toast({
                  title: 'Workspace ready',
                  description: 'Foundation components are wired up correctly.',
                  tone: 'success',
                });
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Tabs
          ariaLabel="Shell demo tabs"
          items={[
            {
              value: 'locking',
              label: 'Locking',
              content: (
                <p>
                  Models and environments are locked independently. A locked version
                  becomes immutable and referenceable by content jobs.
                </p>
              ),
            },
            {
              value: 'versions',
              label: 'Versions',
              content: (
                <p>
                  Every builder system records its own version history, so jobs always
                  reference the exact version they were created with.
                </p>
              ),
            },
            {
              value: 'a11y',
              label: 'Accessibility',
              content: (
                <p>
                  Try Tab, Escape and arrow keys here — focus trapping, roving tabindex
                  and focus restore are built into the shell components.
                </p>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}

