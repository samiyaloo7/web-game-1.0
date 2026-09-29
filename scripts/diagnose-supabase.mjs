import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/**
 * Pre-flight check for the Supabase setup. Run with `npm run supabase:check`.
 *
 * Exists because the most common first-run failure is silent: the keys are
 * valid, Auth works, and only the *schema* is missing — so the app looks
 * connected while every database call fails with `PGRST205`. This prints
 * exactly which objects are missing instead.
 *
 * SECURITY: reads `.env.local` and NEVER prints a key value — only whether one
 * is set, its length, and whether it still looks like the example placeholder.
 */

const raw = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  raw
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const isPlaceholder = (v) => /your-|project-ref|example/i.test(String(v));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;
const fail = (m) => {
  failures++;
  console.log(`  ✗ ${m}`);
};
const pass = (m) => console.log(`  ✓ ${m}`);

console.log('\n── Environment ──────────────────────────────────────');
if (!url) fail('NEXT_PUBLIC_SUPABASE_URL is missing');
else if (isPlaceholder(url)) fail('NEXT_PUBLIC_SUPABASE_URL is still the example placeholder');
else pass(`URL set (${url.replace(/https?:\/\/([^.]+)\..*/, '$1…')})`);

if (!anon) fail('NEXT_PUBLIC_SUPABASE_ANON_KEY (or PUBLISHABLE_KEY) is missing');
else if (isPlaceholder(anon)) fail('anon key is still the example placeholder');
else pass(`anon key set (${anon.slice(0, 12)}…, ${anon.length} chars)`);

if (!service) pass('service key not set — not needed, /api/scores uses the caller JWT');
else if (isPlaceholder(service)) pass('service key is a placeholder — not needed, /api/scores uses the caller JWT');
else pass('service key set (unused by this app)');

// Only the public keys are required to continue: the schema check below runs
// under the anon key, exactly as the app does.
if (failures) {
  console.log('\nFix the public key variables first (Dashboard → Project Settings → API).');
  process.exit(1);
}

const supabase = createClient(url, anon, { auth: { persistSession: false } });

console.log('\n── Schema (supabase/migrations/) ────────────────────');

/**
 * Distinguishes the two failures that look alike but mean opposite things:
 *
 *  - `PGRST205` / PGRST202 — the object does NOT exist → migration not applied.
 *  - `42501` (permission denied) — the object EXISTS and is correctly protected
 *    from this role. For `player_progress` this is the *expected* result: the
 *    migration grants SELECT to `authenticated` only, so an anonymous probe is
 *    refused. It is actually proof that both the table and its RLS policy exist.
 */
function classify(error) {
  if (!error) return 'ok';
  const code = error.code || '';
  if (code === '42501' || /permission denied/i.test(error.message || '')) return 'protected';
  if (
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    /could not find|schema cache/i.test(error.message || '')
  ) {
    return 'missing';
  }
  return 'error';
}

// [name, kind, expectsAnonRead] — `protected` is only a pass when the migration
// is *supposed* to deny anonymous access to that object.
const expected = [
  ['profiles', 'table', true],
  ['scores', 'table', true],
  ['leaderboard', 'view', true],
  ['player_progress', 'table', false], // authenticated-only by design
];

for (const [name, kind, anonReadable] of expected) {
  const { error } = await supabase.from(name).select('*').limit(1);
  const state = classify(error);

  if (state === 'ok') {
    if (anonReadable) pass(`${kind} "${name}" (public read, as expected)`);
    // A readable player_progress would itself be a red flag.
    else fail(`${kind} "${name}" is readable by ANON — expected authenticated-only`);
  } else if (state === 'protected') {
    if (anonReadable) fail(`${kind} "${name}" exists but denies anon read — check grants`);
    else pass(`${kind} "${name}" exists and is locked to signed-in users (as intended)`);
  } else if (state === 'missing') {
    fail(`${kind} "${name}" missing — migration not applied`);
  } else {
    fail(`${kind} "${name}" unexpected error — ${error?.message}`);
  }
}

const rpc = await supabase.rpc('username_available', { p_username: 'zz_setup_probe' });
const rpcState = classify(rpc.error);
if (rpcState === 'ok') pass('function username_available');
else if (rpcState === 'missing') fail('function username_available missing — migration not applied');
else fail(`function username_available unexpected error — ${rpc.error?.message}`);

// --- Leaderboard migration (optional second migration) ---
const lb = await supabase.rpc('leaderboard_page', { p_offset: 0, p_limit: 5 });
if (lb.error) {
  const s = classify(lb.error);
  fail(
    s === 'missing'
      ? 'leaderboard_page missing — apply 20260928120000_leaderboard.sql too'
      : `leaderboard_page error — ${lb.error.message}`
  );
} else {
  pass(`function leaderboard_page (${lb.data?.length ?? 0} row(s) on page 1)`);

  // The generated `score` column must exist, or the view's sum() is broken.
  const cols = await supabase.from('scores').select('id, score, package_id').limit(1);
  if (cols.error && /column/i.test(cols.error.message)) {
    fail(`scores.score missing — ${cols.error.message}`);
  } else {
    pass('generated score column on scores');
  }
}

console.log('\n── Guidance ─────────────────────────────────────────');
if (failures) {
  console.log('Some objects are missing. Apply the migrations, newest last:\n');
  console.log('  1. Supabase Dashboard → SQL Editor');
  console.log('  2. Paste supabase/migrations/20260928090000_initial_schema.sql');
  console.log('  3. Paste supabase/migrations/20260928120000_leaderboard.sql');
  console.log('  4. Click Run\n');
  console.log('Both are idempotent, so re-running either is safe.');
} else {
  console.log('Schema is installed and secured. Next:');
  console.log('  • Authentication → Sign In / Providers → Email → Enable Email provider');
  console.log('  • npm run dev, then register at /login');
  console.log('\nNote: player_progress is only readable while signed in, so it cannot be');
  console.log('probed from this script — it is verified when you load /profile.');
}
console.log('');
process.exit(failures ? 1 : 0);

