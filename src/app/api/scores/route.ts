import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { verifyUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { validateDeliverySubmission } from '@/lib/validation';
import type { Database } from '@/lib/supabase/database';

/**
 * POST /api/scores — record one delivery attempt.
 *
 * ## The trust model
 *
 * This route used to accept `{ status, credits, xp, timeSeconds }` and range
 * check them. Range checking a *claim* is not verification: a courier could post
 * `credits: 1000000` a thousand times and top the board, and every individual
 * request was perfectly valid.
 *
 * The request body now carries only REFERENCES the server resolves itself:
 *
 *   packageId  → looked up in the server-owned `package_defs` table
 *   timeRatio  → a 0..1 fraction, clamped server-side
 *   duration   → informational, bounded, not part of the award formula
 *
 * The award is computed by `submit_delivery()`, a SECURITY DEFINER function that
 * reads `auth.uid()` and the courier's own `player_progress.upgrades`. A forged
 * request can therefore only ever land inside the range a legitimate run would
 * have earned — it cannot invent a payout.
 *
 * ## Why a service-role key is NOT used here
 *
 * Step 9 wrote through the service role because `scores` had no client INSERT
 * grant. Now that `submit_delivery()` exists, the write goes through the
 * caller's own JWT under RLS with no privileged credential at all. That is
 * strictly better: the service key bypasses every policy, so the fewer requests
 * that carry it, the smaller the blast radius of a mistake. `scores` still has
 * no INSERT grant for any client role, so the RPC remains the only write path.
 *
 * ## Ordering of the checks
 *
 * Authenticate BEFORE rate limiting, so an anonymous flooder cannot make the
 * database do work on their behalf, and the count is always the caller's own.
 *
 * `runtime = 'nodejs'` because PostgREST behaves best on the Node runtime, and
 * this route is never a candidate for edge caching.
 */

export const runtime = 'nodejs';

/** Max accepted submissions per minute, per courier. */
const RATE_LIMIT_PER_MINUTE = 20;

export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  // 1. Parse defensively: malformed JSON is a client error, not a crash.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // 2. Shape-check. A usability gate for clean 400s, NOT the security boundary —
  //    the RPC re-derives every number regardless of what passes here.
  const validated = validateDeliverySubmission(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const submission = validated.value;

  // 3. Authenticate. The anon client carries cookies but no write capability of
  //    its own, so this establishes identity without granting anything.
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  const user = await verifyUser(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // 4. Rate limit. Recomputing payouts stops a courier inflating ONE delivery
    //    but not calling this in a loop, and a legitimate high-value package
    //    submitted thousands of times is a real threat. The count is scoped to
    //    the caller's own rows inside the function.
    const { data: recent, error: rateError } = await supabase.rpc('recent_delivery_count', {
      p_within_seconds: 60,
      p_limit: RATE_LIMIT_PER_MINUTE,
    });

    if (!rateError && typeof recent === 'number' && recent >= RATE_LIMIT_PER_MINUTE) {
      return NextResponse.json(
        { error: 'Too many deliveries recorded. Try again shortly.' },
        { status: 429 },
      );
    }

    // 5. A failure awards nothing, so there is nothing to price and nothing to
    //    trust beyond the package id and duration.
    if (submission.status === 'failed') {
      const { error } = await supabase.rpc('record_failure', {
        p_package_id: submission.packageId,
        p_duration_seconds: submission.durationSeconds,
      });
      if (error) {
        console.error('[api/scores] record_failure:', error.message);
        return NextResponse.json({ error: 'Could not record the delivery' }, { status: 500 });
      }
      return NextResponse.json({ status: 'recorded' }, { status: 201 });
    }

    const { data, error } = await supabase.rpc('submit_delivery', {
      p_package_id: submission.packageId,
      p_time_ratio: submission.timeRatio,
      p_duration_seconds: submission.durationSeconds,
      // Audit only. A large gap versus the awarded value is a cheat signal.
      p_claimed_credits: submission.claimedCredits,
    });

    if (error) {
      // An unknown package id is the client's fault (400); anything else is ours
      // (500). The raw message is logged, never returned, because PostgREST text
      // can leak catalog internals.
      const isBadPackage = /unknown package/i.test(error.message);
      console.error('[api/scores] submit_delivery:', error.message);
      return NextResponse.json(
        { error: isBadPackage ? 'Unknown package' : 'Could not record the delivery' },
        { status: isBadPackage ? 400 : 500 },
      );
    }

    // 6. Return the SERVER'S award, not the client's, so a mispredicted client
    //    sees the truth rather than its own claim.
    const row = Array.isArray(data) ? data[0] : data;
    const result = row as
      | Database['public']['Functions']['submit_delivery']['Returns'][number]
      | undefined;

    return NextResponse.json(
      {
        status: 'recorded',
        credits: result?.credits ?? 0,
        xp: result?.xp ?? 0,
        score: result?.score ?? 0,
        isNewBest: result?.is_new_best ?? false,
      },
      { status: 201 },
    );
  } catch (error) {
    // A network or driver failure is a server problem, not a user one.
    console.error('[api/scores] failed:', error);
    return NextResponse.json({ error: 'Could not record the delivery' }, { status: 503 });
  }
}
