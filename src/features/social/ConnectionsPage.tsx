/**
 * Connections settings page (/settings/connections).
 *
 * Provider cards in four honest states (available / connected / not
 * configured / dev-only), connect entry, verify/rename/disconnect actions,
 * and the Security / Publishing / Workspace-scope help cards. No provider
 * logic lives here — everything goes through SocialConnectionsService.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { LockIcon, PlusIcon, AlertIcon, CheckIcon } from '../../components/icons';
import { useToast } from '../../components/ui/Toast';
import { SocialConnectionsService } from '../../services/socialConnectionsService';
import { SocialConnectionEncryptionService } from '../../services/socialConnectionEncryption';
import { createDefaultProviderRegistry } from '../../services/socialProviders';
import { getSocialConnectionsRepository } from '../../data/socialConnectionsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { SocialConnectionRecord } from '../../domain/social';
import type { SocialProviderRecord } from '../../domain/social';
import {
  CONNECTION_STATUS_LABELS,
  CONNECTION_STATUS_TONES,
  connectionDisplayName,
  formatVerifiedAt,
  providerAvailability,
  summarizeScopes,
} from './connectionsUi';

type LoadState = 'loading' | 'error' | 'ready';

export function ConnectionsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Array<SocialProviderRecord & { configured: boolean }>>([]);
  const [connections, setConnections] = useState<SocialConnectionRecord[]>([]);
  const [renaming, setRenaming] = useState<SocialConnectionRecord | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [disconnecting, setDisconnecting] = useState<SocialConnectionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const service = useMemo(
    () =>
      new SocialConnectionsService(
        getSocialConnectionsRepository(),
        createDefaultProviderRegistry(),
        new SocialConnectionEncryptionService(),
      ),
    [],
  );

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [providerRows, connectionRows] = await Promise.all([
        service.listProviders(SEED_GALLERY_WORKSPACE_ID),
        service.listConnections(SEED_GALLERY_WORKSPACE_ID),
      ]);
      setProviders(providerRows);
      setConnections(connectionRows);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load connections.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeByProvider = useMemo(() => {
    const map = new Map<string, SocialConnectionRecord[]>();
    for (const connection of connections) {
      if (connection.status === 'disconnected') continue;
      const list = map.get(connection.providerKey) ?? [];
      list.push(connection);
      map.set(connection.providerKey, list);
    }
    return map;
  }, [connections]);

  async function handleVerify(connectionId: string) {
    setVerifyingId(connectionId);
    try {
      const updated = await service.verifyConnection(connectionId, SEED_GALLERY_WORKSPACE_ID, 'demo-user');
      toast({
        title:
          updated.status === 'connected'
            ? 'Connection verified'
            : CONNECTION_STATUS_LABELS[updated.status],
        description:
          updated.status === 'connected'
            ? 'The account is reachable and its permissions were checked.'
            : updated.lastErrorMessageSafe ?? undefined,
        tone: updated.status === 'connected' ? 'success' : 'warning',
      });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Verification failed.', tone: 'error' });
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleRename() {
    if (!renaming) return;
    setBusy(true);
    try {
      await service.renameConnection(renaming.id, renameValue, SEED_GALLERY_WORKSPACE_ID, 'demo-user');
      toast({ title: 'Connection renamed.', tone: 'success' });
      setRenaming(null);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not rename.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!disconnecting) return;
    setBusy(true);
    try {
      await service.disconnectConnection(disconnecting.id, SEED_GALLERY_WORKSPACE_ID, 'demo-user');
      toast({
        title: 'Account disconnected.',
        description: 'Its tokens were removed and the change was recorded in the audit history.',
        tone: 'success',
      });
      setDisconnecting(null);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not disconnect.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Settings"
        title="Connections"
        description="Connect workspace accounts for future campaign publishing."
      />

      {state === 'loading' ? (
        <Skeleton height={220} />
      ) : state === 'error' ? (
        <EmptyState
          icon={<AlertIcon size={22} />}
          title="Could not load connections"
          description={error ?? 'Something went wrong.'}
          actions={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : (
        <div className="lf-connections-layout">
          <div className="lf-connections-list" role="list">
            {providers.map((provider) => {
              const availability = providerAvailability(provider);
              const providerConnections = activeByProvider.get(provider.key) ?? [];
              const connected = providerConnections[0];
              const isDevOnly = provider.status === 'dev_only';
              return (
                <Card key={provider.key} role="listitem">
                  <CardBody>
                    <div className="lf-campaign-item lf-connection-card">
                      <div className="lf-connection-card__logo" aria-hidden="true">
                        {provider.displayName.charAt(0)}
                      </div>
                      <div className="lf-campaign-item__body">
                        <div className="lf-envcard__title">
                          <strong>{provider.displayName}</strong>
                          {connected ? (
                            <Badge tone={CONNECTION_STATUS_TONES[connected.status]} dot>
                              {CONNECTION_STATUS_LABELS[connected.status]}
                            </Badge>
                          ) : !isDevOnly ? (
                            <Badge tone={availability.tone}>{availability.label}</Badge>
                          ) : (
                            <Badge tone="warning">Development only</Badge>
                          )}
                        </div>
                        {connected ? (
                          <>
                            <p className="lf-tile__description">
                              {connectionDisplayName(connected)}
                              {connected.externalAccountType
                                ? ` · ${connected.externalAccountType}`
                                : ''}
                            </p>
                            <p className="lf-tile__description">
                              Last verified: {formatVerifiedAt(connected.lastVerifiedAt)}
                            </p>
                            <p className="lf-tile__description">
                              Permissions: {summarizeScopes(connected.grantedScopes)}
                            </p>
                            {connected.lastErrorMessageSafe ? (
                              <p className="lf-tile__description" role="status">
                                <Badge tone="warning" dot>
                                  {connected.lastErrorMessageSafe}
                                </Badge>
                              </p>
                            ) : null}
                          </>
                        ) : availability.unconfigured ? (
                          <p className="lf-tile__description">
                            Provider credentials are not configured. Connection is unavailable
                            until the workspace hosting environment provides them.
                          </p>
                        ) : (
                          <p className="lf-tile__description">
                            {isDevOnly
                              ? 'Simulated provider for development and demos. Never presented as a production platform.'
                              : 'No workspace account connected yet. Publishing workflows arrive after connections are verified.'}
                          </p>
                        )}
                      </div>
                      <div className="lf-campaign-item__actions">
                        {connected ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => void handleVerify(connected.id)}
                              disabled={verifyingId === connected.id}
                            >
                              {verifyingId === connected.id ? 'Verifying…' : 'Verify connection'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setRenaming(connected);
                                setRenameValue(connected.localName);
                              }}
                            >
                              Rename
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDisconnecting(connected)}>
                              Disconnect
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="primary"
                            disabled={availability.connectDisabled}
                            onClick={() => navigate(`/settings/connections/${provider.key}/connect`)}
                          >
                            <PlusIcon size={14} /> Connect
                          </Button>
                        )}
                      </div>
                    </div>
                    {connected && availability.unconfigured ? (
                      <p className="lf-tile__description">
                        Provider credentials are not configured for new connections.
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              );
            })}
            {providers.length === 0 ? (
              <EmptyState
                icon={<LockIcon size={22} />}
                title="No providers registered"
                description="Provider registry entries appear here once the migration has run."
              />
            ) : null}
          </div>

          <aside className="lf-connections-help" aria-label="Connection help">
            <Card>
              <CardHeader title="Security" />
              <CardBody>
                <p className="lf-tile__description">
                  <LockIcon size={14} /> Tokens are stored securely on the server and never exposed
                  in the browser.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Publishing" />
              <CardBody>
                <p className="lf-tile__description">
                  <CheckIcon size={14} /> Publishing workflows are added in the next step after
                  connections are verified.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Workspace scope" />
              <CardBody>
                <p className="lf-tile__description">
                  Connections belong to this workspace and can be reused across campaign channels.
                </p>
              </CardBody>
            </Card>
          </aside>
        </div>
      )}

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename connection"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void handleRename()}>
              Save name
            </Button>
          </div>
        }
      >
        <Input
          label="Local name"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          hint="Shown only inside LockFlow — never sent to the provider."
        />
      </Modal>

      <Modal
        open={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        title="Disconnect account"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setDisconnecting(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => void handleDisconnect()}>
              Disconnect
            </Button>
          </div>
        }
      >
        <p>
          Disconnecting removes this account from future publishing choices. Existing campaign
          plans will remain unchanged.
        </p>
      </Modal>
    </div>
  );
}
