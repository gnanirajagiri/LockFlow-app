import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';

export function SettingsPage() {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  return (
    <div className="lf-page">
      <PageHeader
        title="Settings"
        description="Account and workspace preferences. Settings become persistent once the database is connected."
      />
      <Card style={{ marginBottom: 'var(--lf-space-4)' }}>
        <CardBody>
          <div className="lf-campaign-item">
            <div className="lf-campaign-item__body">
              <strong>Connections</strong>
              <p className="lf-tile__description">
                Connect workspace accounts (Meta, TikTok, YouTube, LinkedIn) for future campaign
                publishing. Tokens stay on the server — publishing is not enabled yet.
              </p>
            </div>
            <div className="lf-campaign-item__actions">
              <Link className="lf-btn lf-btn--secondary" to="/settings/connections">
                Manage connections
              </Link>
            </div>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="General"
          description="A working preview of the settings surface, using the shared form primitives."
        />
        <CardBody>
          <Tabs
            ariaLabel="Settings sections"
            items={[
              {
                value: 'profile',
                label: 'Profile',
                content: (
                  <div style={{ display: 'grid', gap: 'var(--lf-space-4)', maxWidth: 420 }}>
                    <Input
                      label="Display name"
                      placeholder="Your name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                    <Input
                      label="Email"
                      type="email"
                      placeholder="you@studio.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      hint="Used for sign-in and notifications."
                    />
                    <div>
                      <Button
                        variant="primary"
                        onClick={() =>
                          toast({ title: 'Saved (locally)', description: 'Persistence arrives with the database.', tone: 'info' })
                        }
                      >
                        Save changes
                      </Button>
                    </div>
                  </div>
                ),
              },
              {
                value: 'appearance',
                label: 'Appearance',
                content: (
                  <p>
                    LockFlow ships with its calm creative-studio theme only for now.
                    Theme options will appear here.
                  </p>
                ),
              },
              {
                value: 'danger',
                label: 'Advanced',
                content: <p>Danger-zone actions (workspace deletion, data export) arrive with data features.</p>,
              },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
