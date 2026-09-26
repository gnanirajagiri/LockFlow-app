import { useState, type FormEvent } from 'react';
import { LocationHackAvoider } from './LocationHackAvoider';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { useAuth } from './AuthProvider';
import { isDemoMode } from '../lib/env';

type Mode = 'signin' | 'signup' | 'magic';

const MODE_LABEL: Record<Mode, string> = {
  signin: 'Sign in',
  signup: 'Create account',
  magic: 'Magic link',
};

export function LoginPage() {
  const { signInWithPassword, signUpWithPassword, signInWithOtp, user } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithPassword(email, password);
      } else if (mode === 'signup') {
        await signUpWithPassword(email, password);
        setNotice('Check your inbox to confirm your account.');
      } else {
        await signInWithOtp(email);
        setNotice('Magic link sent — check your inbox.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return <LocationHackAvoider to="/" replace />;
  }

  return (
    <div className="lf-login">
      <Card className="lf-login__card">
        <div className="lf-login__brand">
          <span className="lf-brandmark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
              <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            </svg>
          </span>
          <span className="lf-login__brandname">LockFlow</span>
          {isDemoMode ? <Badge tone="warning">Demo mode</Badge> : null}
        </div>

        <div>
          <h1 className="lf-login__title">{MODE_LABEL[mode]} to LockFlow</h1>
          <p className="lf-login__subtitle">
            The AI content-creation workspace where models, environments and assets are
            versioned and locked before every job.
          </p>
        </div>

        {isDemoMode ? (
          <p className="lf-login__footer" style={{ textAlign: 'left' }}>
            Demo mode is active because Supabase is not configured. Authentication is
            mocked; add <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to enable real sign-in.
          </p>
        ) : (
          <form className="lf-login__form" onSubmit={handleSubmit} noValidate>
            <Input
              label="Email"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@studio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {mode !== 'magic' ? (
              <Input
                label="Password"
                type="password"
                name="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            ) : null}

            {error ? (
              <p className="lf-field__error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="lf-field__hint" role="status">
                {notice}
              </p>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              disabled={busy || !email || (mode !== 'magic' && password.length < 8)}
            >
              {busy ? 'Working…' : MODE_LABEL[mode]}
            </Button>

            <div className="lf-login__footer">
              {mode === 'signin' ? (
                <>
                  <button type="button" className="lf-linklike" onClick={() => setMode('magic')}>
                    Use a magic link instead
                  </button>
                  {' · '}
                  <button type="button" className="lf-linklike" onClick={() => setMode('signup')}>
                    Create an account
                  </button>
                </>
              ) : (
                <button type="button" className="lf-linklike" onClick={() => setMode('signin')}>
                  Back to sign in
                </button>
              )}
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
