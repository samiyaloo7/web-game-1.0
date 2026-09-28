/**
 * Public Supabase configuration.
 *
 * Next.js statically replaces every `process.env.NEXT_PUBLIC_*` reference in
 * client code at build time — that is the mechanism that makes these two values
 * readable in the browser, and the reason only *public* data may use the prefix.
 * The service-role key deliberately lives nowhere near this module.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * The whole app degrades gracefully when Supabase is not configured: pages show
 * a "not connected" state instead of crashing, and the game keeps running as a
 * local-only session. This keeps `next build` green on machines with no secrets.
 */
export const isSupabaseConfigured =
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 0;
