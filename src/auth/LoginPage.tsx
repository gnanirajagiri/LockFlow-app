import { useState, type FormEvent } from 'react';
import { LocationHackAvoider } from './LocationHackAvoider';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { useAuth } from './AuthProvider';
import { isDemoMode } from '../lib/env';
import { LockIcon } from '../components/icons';

type Mode = 'signin' | 'signup' | 'magic';

const MODE_LABEL: Record<Mode, string> = {
  signin: 'Sign in',
  signup: 'Create account',
  magic: 'Email me a magic link',
};

/**
 * Stage-5 S01/S02 auth screen: split layout — navy brand panel with the
 * Fraunces "Create once. Lock the details." hero, model photo, feature chips
 * and a version pill; form panel with email/password, SSO buttons and the
 * magic-link switcher. In demo mode the form is mocked: any valid email +
 * 8+ char password signs in to the demo session.
 */
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
    <div className="lf-auth">
      <div className="lf-auth__brand">
        <div className="lf-auth__brandbar">
          <span className="lf-brandmark" aria-hidden="true">
            <LockIcon size={16} />
          </span>
          <span className="lf-auth__brandname">LockFlow</span>
          {isDemoMode ? <Badge tone="lav">Demo</Badge> : null}
        </div>
        <div className="lf-auth__hero">
          <h1 className="lf-auth__herotitle">
            Create once.
            <br />
            Lock the details.
          </h1>
          <p className="lf-auth__herosub">
            Generate consistent content without the technical workflow.
          </p>
          <div className="lf-auth__chips">
            <span className="lf-auth__chip">Locked models</span>
            <span className="lf-auth__chip">Locked environments</span>
            <span className="lf-auth__chip">One Library</span>
          </div>
        </div>
        <span className="lf-auth__pill">
          <LockIcon size={11} /> Aria v1 · Locked
        </span>
      </div>

      <div className="lf-auth__panel">
        <div className="lf-auth__formwrap">
          <div className="lf-auth__brandbar lf-auth__brandbar--mobile">
            <span className="lf-brandmark" aria-hidden="true">
              <LockIcon size={16} />
            </span>
            <span className="lf-auth__brandname">LockFlow</span>
            {isDemoMode ? <Badge tone="lav">Demo</Badge> : null}
          </div>

          <h2 className="lf-auth__title">
            {mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Magic link'}
          </h2>
          <p className="lf-auth__subtitle">
            {mode === 'magic'
              ? 'We will email you a one-time sign-in link.'
              : mode === 'signup'
                ? 'Start your LockFlow workspace.'
                : 'Sign in to your LockFlow workspace.'}
          </p>

          {isDemoMode ? (
            <p className="lf-auth__demo" role="note">
              Demo mode: authentication is mocked — any email and an 8+ character
              password will open the demo workspace.
            </p>
          ) : null}

          <form className="lf-auth__form" onSubmit={handleSubmit} noValidate>
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
              <div className="lf-auth__passrow">
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
                {mode === 'signin' ? (
                  <button
                    type="button"
                    className="lf-auth__forgot"
                    onClick={() => setMode('magic')}
                  >
                    Forgot password?
                  </button>
                ) : null}
              </div>
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

            <button
              type="submit"
              className="lf-btn lf-btn--primary lf-btn--lg lf-btn--block"
              disabled={busy || !email || (mode !== 'magic' && password.length < 8)}
            >
              {busy ? 'Working…' : MODE_LABEL[mode]}
            </button>

            <div className="lf-auth__divider" role="separator" aria-label="or">
              <span>or</span>
            </div>

            <div className="lf-auth__sso">
              <button type="button" className="lf-auth__ssobtn" disabled>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
                </svg>
                Google
              </button>
              <button type="button" className="lf-auth__ssobtn" disabled>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 20c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" />
                </svg>
                Apple
              </button>
            </div>
            <p className="lf-auth__ssosub">SSO buttons enable once a provider is configured.</p>

            {mode !== 'magic' ? (
              <button type="button" className="lf-auth__magiclink" onClick={() => setMode('magic')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
                  <path d="m4 7 8 6 8-6" />
                </svg>
                Email me a magic link
              </button>
            ) : (
              <button type="button" className="lf-auth__magiclink" onClick={() => setMode('signin')}>
                Back to password sign-in
              </button>
            )}

            <p className="lf-auth__switch">
              {mode === 'signup' ? 'Already have an account?' : 'New to LockFlow?'}{' '}
              <button
                type="button"
                className="lf-linklike"
                onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
              >
                {mode === 'signup' ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
