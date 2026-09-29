/**
 * Connect + callback routes.
 *
 * /settings/connections/:providerKey/connect — starts the server-side flow.
 * /settings/connections/callback/:providerKey — validates the provider
 * redirect, completes the handshake through the service, and redirects back
 * to the Connections index with a safe toast. Raw provider errors never
 * reach this component; the service throws safe messages only.
 *
 * Note: in this SPA the "server-side" steps run through the service boundary
 * that owns the encryption key; in the hosted deployment these two routes
 * map to edge/server handlers with the same contract.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { AlertIcon, LockIcon } from '../../components/icons';
import { useToast } from '../../components/ui/Toast';
import { SocialConnectionsService } from '../../services/socialConnectionsService';
import { SocialConnectionEncryptionService } from '../../services/socialConnectionEncryption';
import { createDefaultProviderRegistry } from '../../services/socialProviders';
import { getSocialConnectionsRepository } from '../../data/socialConnectionsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';

function useConnectionService() {
  return useMemo(
    () =>
      new SocialConnectionsService(
        getSocialConnectionsRepository(),
        createDefaultProviderRegistry(),
        new SocialConnectionEncryptionService(),
      ),
    [],
  );
}

export function ConnectionStartPage() {
  const { providerKey = '' } = useParams();
  const navigate = useNavigate();
  const service = useConnectionService();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  const start = useCallback(async () => {
    setError(null);
    try {
      const result = await service.startConnection(
        { providerKey, workspaceId: SEED_GALLERY_WORKSPACE_ID, userId: 'demo-user' },
        'demo-user',
      );
      // In the hosted deployment the server issues a redirect to the
      // provider. Here we hand off through the simulated consent step.
      const authUrl = new URL(result.authorizationUrl);
      const state = authUrl.searchParams.get('state');
      if (!state) throw new Error('The provider did not return a flow state.');
      navigate(
        `/settings/connections/callback/${providerKey}?state=${encodeURIComponent(state)}&code=dev_auth_code`,
        { replace: true },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The connection could not be started.');
    }
  }, [navigate, providerKey, service]);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void start();
  }, [start]);

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Settings"
        title="Connect an account"
        description="The authorization handshake happens securely — tokens never touch the browser."
      />
      <Card>
        <CardBody>
          {error ? (
            <EmptyState
              icon={<AlertIcon size={22} />}
              title="Connection could not start"
              description={error}
              actions={
                <Button onClick={() => navigate('/settings/connections')}>Back to Connections</Button>
              }
            />
          ) : (
            <p className="lf-tile__description">
              <LockIcon size={14} /> Starting the secure authorization handshake…
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function ConnectionCallbackPage() {
  const { providerKey = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const service = useConnectionService();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const state = searchParams.get('state');
    const code = searchParams.get('code');
    const providerError = searchParams.get('error_description') ?? searchParams.get('error');

    async function finish() {
      try {
        if (providerError) {
          // Provider declined (user cancelled, denied scopes, etc.) — safe message.
          throw new Error('This provider connection needs to be tried again.');
        }
        if (!state || !code) {
          throw new Error('Connection expired before completion. Please try again.');
        }
        await service.completeConnection(
          {
            providerKey,
            workspaceId: SEED_GALLERY_WORKSPACE_ID,
            plainStateToken: state,
            code,
          },
          'demo-user',
        );
        toast({ title: 'Account connected successfully.', tone: 'success' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'This provider connection needs to be tried again.';
        setError(message);
        toast({ title: message, tone: 'error' });
        // Give the toast a beat to be seen, then return to the index.
        window.setTimeout(() => navigate('/settings/connections', { replace: true }), 1200);
        return;
      }
      navigate('/settings/connections', { replace: true });
    }

    void finish();
  }, [navigate, providerKey, searchParams, service, toast]);

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Settings"
        title="Finishing connection"
        description="Validating the authorization and verifying the account."
      />
      <Card>
        <CardBody>
          {error ? (
            <p className="lf-tile__description" role="alert">
              <Badge tone="danger" dot>
                {error}
              </Badge>
            </p>
          ) : (
            <p className="lf-tile__description">Completing the secure handshake…</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
