import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * SECURITY REGRESSION GUARD
 * =========================
 *
 * These are static checks, not behavioural tests, but they protect the single
 * property that cannot be verified by any unit test: that the service-role key
 * never reaches the browser.
 *
 * The anon key is *designed* to be public — it is useless without the RLS
 * policies in the migration. The service key is the opposite: it bypasses RLS
 * entirely, so anyone holding it can read and rewrite the whole database. It
 * must therefore never appear in a client module, a `NEXT_PUBLIC_` variable, or
 * a component rendered to the browser.
 */

const SRC_ROOT = join(process.cwd(), 'src');

/** Every `.ts`/`.tsx` under src, as repo-relative paths. */
function listSourceFiles(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALL_SOURCE_FILES = listSourceFiles();

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** True when the module is part of the browser bundle graph. */
function isClientModule(file: string): boolean {
  const source = read(file);
  return (
    source.includes("'use client'") ||
    source.includes('"use client"') ||
    file.includes(`${join('components', '')}`) ||
    file.includes(`${join('hooks', '')}`) ||
    file.includes(`${join('stores', '')}`)
  );
}

describe('service-role key containment', () => {
  it('finds the source tree (guards against a silently empty scan)', () => {
    expect(ALL_SOURCE_FILES.length).toBeGreaterThan(20);
  });

  it('is never read through a NEXT_PUBLIC_ variable', () => {
    // A `NEXT_PUBLIC_` prefix is inlined into the browser bundle at build time,
    // which would publish the key to every visitor.
    for (const file of ALL_SOURCE_FILES) {
      const source = read(file);
      expect(
        /NEXT_PUBLIC_[A-Z_]*SERVICE/i.test(source),
        `${relative(process.cwd(), file)} exposes the service key publicly`
      ).toBe(false);
    }
  });

  it('is not imported by any client component', () => {
    for (const file of ALL_SOURCE_FILES) {
      if (!isClientModule(file)) continue;
      const source = read(file);
      expect(
        /from ['"][^'"]*supabase\/service['"]/.test(source),
        `${relative(process.cwd(), file)} imports the service client`
      ).toBe(false);
    }
  });

  it('only reads process.env.SUPABASE_SERVICE_ROLE_KEY in the service module', () => {
    const readers = ALL_SOURCE_FILES.filter((file) =>
      read(file).includes('process.env.SUPABASE_SERVICE_ROLE_KEY')
    );

    expect(readers.map((f) => relative(process.cwd(), f))).toEqual(
      expect.arrayContaining([join('src', 'lib', 'supabase', 'service.ts')])
    );
    // Exactly one reader: anywhere else is a leak waiting to happen.
    expect(readers).toHaveLength(1);
  });

  it('keeps the service client guarded against browser construction', () => {
    const service = read(join(SRC_ROOT, 'lib', 'supabase', 'service.ts'));
    expect(service).toContain('typeof window');
    expect(service).toContain('must never be constructed in the browser');
  });
});

describe('progression and scoring write paths', () => {
  it('never import the service client from the browser progression writer', () => {
    const client = read(join(SRC_ROOT, 'lib', 'progression', 'client.ts'));
    // Saves go through the SECURITY DEFINER RPC under the caller's own JWT.
    expect(client).toContain("from '../supabase/browser'");
    expect(client).not.toContain('supabase/service');
    expect(client).toContain('save_player_progress');
  });

  it('never lets the score owner come from the request body', () => {
    const route = read(join(SRC_ROOT, 'app', 'api', 'scores', 'route.ts'));

    // Strongest possible guarantee: the route does not mention `profile_id` at
    // all. The RPC derives the owner from `auth.uid()`, so there is no code path
    // that could be edited into accepting a caller-supplied id.
    expect(route).not.toContain('profile_id');

    // And the validation layer refuses to carry one either.
    const validation = read(join(SRC_ROOT, 'lib', 'validation.ts'));
    expect(validation).not.toMatch(/profile_id/);
  });

  it('accepts no client-supplied payout — the server recomputes it', () => {
    const route = read(join(SRC_ROOT, 'app', 'api', 'scores', 'route.ts'));

    // The RPC is invoked with references only.
    expect(route).toContain('submit_delivery');

    // No award may be read off the request. The `\b` guards are load-bearing:
    // without them `p_claimed_credits: submission.claimedCredits` would false-positive
    // on the inner `credits: submission...` substring.
    expect(route).not.toMatch(/\bcredits:\s*(body|submission)\b/);
    expect(route).not.toMatch(/\bxp:\s*(body|submission)\b/);

    // The only credits-shaped keys present are the audit field and the RESPONSE,
    // which echoes the server's own award back to the client.
    const creditsKeys = route.match(/\b\w*credits\w*:/g) ?? [];
    for (const key of creditsKeys) {
      expect(['p_claimed_credits:', 'credits:']).toContain(key);
    }
  });

  it('routes the write through the session JWT, not the service key', () => {
    const route = read(join(SRC_ROOT, 'app', 'api', 'scores', 'route.ts'));
    // The privileged client bypasses RLS; the board no longer needs it.
    expect(route).not.toContain('createSupabaseServiceClient');
    expect(route).not.toContain('supabase/service');
    expect(route).toContain('verifyUser');
  });
});
