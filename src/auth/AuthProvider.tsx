import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { isDemoMode } from '../lib/env';
import { pullCloudAvatar, setAvatarUserProvider } from '../generation/avatar';

export interface AuthUser {
  /** Supabase user id (or `demo-user` in demo mode). */
  id: string;
  email: string;
  /** Best-effort display name from metadata. */
  name: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  /** True until the initial session check resolves. */
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  /** Passwordless magic link. */
  signInWithOtp: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** True when running on the mock in-memory session (no Supabase configured). */
  isDemoSession: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Demo-mode placeholder user so the shell is explorable without a backend. */
const DEMO_USER: AuthUser = {
  id: 'demo-user',
  email: 'demo@lockflow.local',
  name: 'Demo User',
};

function toAuthUser(user: User | null | undefined): AuthUser | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  return {
    id: user.id,
    email: user.email ?? '',
    name: meta.full_name ?? meta.name ?? user.email?.split('@')[0] ?? 'Member',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(isDemoMode ? DEMO_USER : null);
  const [loading, setLoading] = useState(!isDemoMode);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setUser(toAuthUser(data.session?.user));
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(toAuthUser(nextSession?.user));
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  // Register the account id with the avatar store and pull the cloud avatar
  // once per session (no-op unless cloud sync is enabled in Settings).
  useEffect(() => {
    setAvatarUserProvider(() => user?.id ?? null);
    if (user && !isDemoMode) void pullCloudAvatar();
  }, [user]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const client = getSupabase();
    if (!client) throw new Error('Authentication is not configured (demo mode).');
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    const client = getSupabase();
    if (!client) throw new Error('Authentication is not configured (demo mode).');
    const { error } = await client.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signInWithOtp = useCallback(async (email: string) => {
    const client = getSupabase();
    if (!client) throw new Error('Authentication is not configured (demo mode).');
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabase();
    if (!client) {
      setUser(null);
      return;
    }
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      signInWithPassword,
      signUpWithPassword,
      signInWithOtp,
      signOut,
      isDemoSession: isDemoMode && user?.id === DEMO_USER.id,
    }),
    [user, session, loading, signInWithPassword, signUpWithPassword, signInWithOtp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
