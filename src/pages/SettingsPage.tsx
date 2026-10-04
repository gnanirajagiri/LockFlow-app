import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';
import { Badge } from '../components/ui/Badge';
import { getGenerationRepository, DEMO_GENERATION_CONFIG } from '../generation/factory';
import { getOpenAiApiKey, setOpenAiApiKey } from '../generation/openAiImageProvider';

type AiProviderChoice = 'development-fake' | 'openai';

export function SettingsPage() {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [aiProvider, setAiProvider] = useState<AiProviderChoice>('development-fake');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);

  // Current generation config (drives which provider image jobs actually use).
  useEffect(() => {
    void (async () => {
      try {
        const config = await getGenerationRepository().getConfig();
        setAiProvider(config.providerName === 'openai' ? 'openai' : 'development-fake');
      } catch {
        setAiProvider('development-fake');
      }
      const key = getOpenAiApiKey();
      setHasKey(key.trim() !== '');
    })();
  }, []);

  async function saveAiProvider() {
    if (aiProvider === 'openai') {
      const key = apiKey.trim() || getOpenAiApiKey();
      if (key === '') {
        toast({
          title: 'API key required',
          description: 'Paste your OpenAI API key to enable real image generation.',
          tone: 'error',
        });
        return;
      }
      if (apiKey.trim() !== '') setOpenAiApiKey(apiKey.trim());
      setHasKey(getOpenAiApiKey().trim() !== '');
      const repo = getGenerationRepository();
      const config = await repo.getConfig();
      await repo.setConfig({ ...config, imageGenerationEnabled: true, providerName: 'openai' });
      toast({
        title: 'OpenAI image generation enabled',
        description: 'New image jobs call gpt-image-1 with your key. The key stays in this browser only.',
        tone: 'success',
      });
    } else {
      const repo = getGenerationRepository();
      const config = await repo.getConfig();
      await repo.setConfig({ ...config, ...DEMO_GENERATION_CONFIG });
      toast({
        title: 'Using the development fake provider',
        description: 'Image jobs render placeholder media — nothing is sent to OpenAI.',
        tone: 'info',
      });
    }
  }

  return (
    <div className="lf-page">
      <PageHeader
        title="Settings"
        description="Account and workspace preferences. Settings become persistent once the database is connected."
      />
      <Card style={{ marginBottom: 'var(--lf-space-4)' }}>
        <CardHeader
          title="AI image generation"
          description="Choose how Content Studio renders generated images. Everything else (eligibility, quotas, audit, Gallery) behaves identically."
        />
        <CardBody>
          <div style={{ display: 'grid', gap: 'var(--lf-space-4)', maxWidth: 560 }}>
            <label style={{ display: 'grid', gap: 'var(--lf-space-2)', cursor: 'pointer' }}>
              <span style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="ai-provider"
                  checked={aiProvider === 'openai'}
                  onChange={() => setAiProvider('openai')}
                />
                <strong>OpenAI · gpt-image-1</strong>
                {aiProvider === 'openai' && hasKey ? <Badge tone="success">key saved</Badge> : null}
              </span>
              <span className="lf-tile__description">
                Real AI image generation. Uses your own OpenAI API key.
              </span>
              {aiProvider === 'openai' ? (
                <Input
                  label="OpenAI API key"
                  type="password"
                  placeholder={hasKey ? '•••••••• (saved — leave blank to keep)' : 'sk-…'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  hint="Stored in this browser only and sent solely to api.openai.com — never written to jobs, audit rows or Gallery metadata. For production use, move this call behind your server."
                />
              ) : null}
            </label>
            <label style={{ display: 'grid', gap: 'var(--lf-space-2)', cursor: 'pointer' }}>
              <span style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="ai-provider"
                  checked={aiProvider === 'development-fake'}
                  onChange={() => setAiProvider('development-fake')}
                />
                <strong>Development fake</strong>
              </span>
              <span className="lf-tile__description">
                Placeholder media for demos and tests — clearly marked, never mistaken for real generation.
              </span>
            </label>
            <div>
              <Button variant="primary" onClick={() => void saveAiProvider()}>
                Save AI provider
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
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
