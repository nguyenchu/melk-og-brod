import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? null;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? null;

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

export function hasSupabaseConfig() {
  return supabase !== null;
}

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Appen mangler Supabase-konfigurasjon i builden. Sett EXPO_PUBLIC_SUPABASE_URL og EXPO_PUBLIC_SUPABASE_ANON_KEY i EAS.',
    );
  }
  return supabase;
}
