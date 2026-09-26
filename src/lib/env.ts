/**
 * Typed access to build-time environment variables.
 *
 * Demo mode: when Supabase credentials are absent the app runs against a mock
 * in-memory session so the shell is explorable without a backend. Demo mode is
 * a development convenience only — real data features must never rely on it.
 */
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseUrl = url || '';
export const supabaseAnonKey = anonKey || '';

export const isSupabaseConfigured = Boolean(url && anonKey);
export const isDemoMode = !isSupabaseConfigured;
