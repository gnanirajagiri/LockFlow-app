import { useEffect, useRef, useState } from 'react';
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
import {
  setUploadedAvatar,
  clearUploadedAvatar,
  clearGeneratedAvatar,
  generateAvatar,
  getCloudSyncInfo,
  setCloudSyncEnabled,
  subscribeToAvatars,
  type CloudSyncInfo,
} from '../generation/avatar';
import { useAvatar } from '../generation/useAvatar';
import { isDemoMode } from '../lib/env';

type AiProviderChoice = 'development-fake' | 'openai';

/** Reads a picked image file and downscales it to a square 256×256 data-URI. */
function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That file is not a readable image.'));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Your browser blocked image processing.'));
          return;
        }
        // Cover-crop the source to a square, then draw at 256×256.
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const offsetX = (image.naturalWidth - side) / 2;
        const offsetY = (image.naturalHeight - side) / 2;
        context.drawImage(image, offsetX, offsetY, side, side, 0, 0, 256, 256);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Human-readable state for the avatar cloud-sync toggle. */
function cloudStatusLabel(info: CloudSyncInfo): string {
  if (!info.enabled) return 'Off — stored in this browser only';
  if (isDemoMode) return 'On — connect the database to sync across devices';
  switch (info.status) {
    case 'anonymous':
      return 'On — sign in to sync across devices';
    case 'syncing':
      return 'Syncing…';
    case 'available':
      return info.hasCloudAvatar ? 'Synced across your devices' : 'On — no cloud avatar yet';
    case 'unavailable':
      return 'Cloud unavailable — using this browser';
    default:
      return 'Connecting…';
  }
}

export function SettingsPage() {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [aiProvider, setAiProvider] = useState<AiProviderChoice>('development-fake');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const userAvatar = useAvatar('user');
  const workspaceAvatar = useAvatar('workspace');
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const [cloudSync, setCloudSync] = useState<CloudSyncInfo>(() => getCloudSyncInfo());

  // Keep the preview, badge and sync status in step with every avatar change.
  useEffect(() => subscribeToAvatars(() => {
    setCloudSync(getCloudSyncInfo());
  }), []);

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

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Not an image', description: 'Choose a PNG or JPG photo.', tone: 'error' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Image too large', description: 'Pick a photo under 10 MB.', tone: 'error' });
      return;
    }
    try {
      const dataUri = await readImageFile(file);
      clearGeneratedAvatar('user'); // uploads replace generated portraits
      clearUploadedAvatar('user');
      setUploadedAvatar('user', dataUri);
      toast({
        title: 'Profile photo updated',
        description: 'Your photo appears in the topbar across Maya. It stays in this browser only.',
        tone: 'success',
      });
    } catch (err) {
      toast({
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'Could not process that image.',
        tone: 'error',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleGenerateAvatar() {
    setGeneratingAvatar(true);
    try {
      await generateAvatar('user');
      toast({
        title: 'AI portrait generated',
        description: 'Your generated avatar now appears in the topbar. Generate again for a different take.',
        tone: 'success',
      });
    } catch (err) {
      toast({
        title: 'Generation failed',
        description: err instanceof Error ? err.message : 'Could not generate an avatar right now.',
        tone: 'error',
      });
    } finally {
      setGeneratingAvatar(false);
    }
  }

  const avatarDescription = userAvatar.origin === 'upload'
    ? 'Your uploaded photo is used everywhere the account avatar appears.'
    : userAvatar.origin === 'generated'
      ? 'AI-generated portrait (gpt-image-1). Upload a photo to replace it, or generate again for a new take.'
      : 'Upload a photo, or generate an AI portrait. Until then the topbar shows your initial.';

  return (
    <div className="lf-page">
      <PageHeader
        title="Settings"
        description="Account and workspace preferences. Settings become persistent once the database is connected."
      />

      <Card style={{ marginBottom: 'var(--lf-space-4)' }}>
        <CardHeader
          title="Profile photo"
          description={avatarDescription}
        />
        <CardBody>
          <div className="lf-avatarsettings">
            <div className="lf-avatarsettings__previewwrap">
              {userAvatar.src ? (
                <img className="lf-avatarsettings__preview" src={userAvatar.src} alt="Current profile photo" />
              ) : (
                <span className="lf-avatar lf-avatar--photo lf-avatarsettings__preview lf-avatarsettings__preview--letter" aria-hidden="true">
                  {(displayName.trim() || 'Demo User').slice(0, 1).toUpperCase()}
                </span>
              )}
              {userAvatar.generating || generatingAvatar ? (
                <span className="lf-avatarsettings__spinner" role="status" aria-label="Generating avatar" />
              ) : null}
            </div>
            <div className="lf-avatarsettings__origin">
              {userAvatar.origin ? (
                <Badge tone={userAvatar.origin === 'upload' ? 'success' : 'info'}>
                  {userAvatar.origin === 'upload' ? 'uploaded photo' : 'AI-generated'}
                </Badge>
              ) : (
                <Badge tone="neutral">no photo yet</Badge>
              )}
            </div>
            <div className="lf-avatarsettings__actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="lf-visually-hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => void handleAvatarFile(event.target.files?.[0])}
              />
              <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
                Upload photo
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleGenerateAvatar()}
                disabled={generatingAvatar || !hasKey}
                title={hasKey ? 'Generate a portrait with gpt-image-1' : 'Save an OpenAI API key below first'}
              >
                {generatingAvatar || userAvatar.generating ? 'Generating…' : 'Generate with AI'}
              </Button>
              {userAvatar.src ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    clearUploadedAvatar('user');
                    toast({ title: 'Photo removed', description: 'The topbar is back to your generated portrait or initial.', tone: 'info' });
                  }}
                >
                  Remove photo
                </Button>
              ) : null}
            </div>
            <div className="lf-avatarsettings__sync">
              <label className="lf-avatarsettings__synctoggle" htmlFor="avatar-cloud-sync">
                <input
                  id="avatar-cloud-sync"
                  type="checkbox"
                  checked={cloudSync.enabled}
                  onChange={(event) => setCloudSyncEnabled(event.target.checked)}
                  disabled={generatingAvatar || userAvatar.generating}
                />
                <span>
                  <strong>Sync across devices</strong>
                  <span className="lf-avatarsettings__syncstatus">{cloudStatusLabel(cloudSync)}</span>
                </span>
              </label>
            </div>
            <p className="lf-field__hint">
              Photos are resized to 256×256. With sync off they stay in this browser only
              (localStorage); with sync on the account avatar mirrors to your private
              storage and follows you across devices. The workspace avatar uses the same
              flow locally; the workspace portrait currently comes from
              {' '}{workspaceAvatar.origin === 'upload' ? 'an uploaded photo' : workspaceAvatar.origin === 'generated' ? 'AI generation' : 'the default'}.
            </p>
          </div>
        </CardBody>
      </Card>

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
