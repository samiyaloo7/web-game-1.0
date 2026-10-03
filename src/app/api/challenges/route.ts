import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { verifyUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { validateChallengeProgressSubmission } from '@/lib/validation';
import { challengeProgressFromRpc } from '@/lib/challenges/mapping';
import { loadTodayChallenge } from '@/lib/challenges/server';
import { buildDailyChallengeContext } from '@/game/systems/DailyChallenge';
import type { Database } from '@/lib/supabase/database';

/**
 * /api/challenges — the daily challenge's clock authority.
 *
 * ## GET — "what is today's challenge?"
 *
 * The server derives the day from ITS OWN clock and regenerates the challenge
 * deterministically. The browser's clock is never consulted. The response also
 * carries `secondsUntilReset` so the client can schedule a refetch at the UTC
 * boundary without trusting its own timezone or system time.
 *
 * ## POST — "my attempt reached N"
 *
 * The body is `{ dayIndex, progress }` and nothing else. The server:
 *   1. re-derives the current day from its own clock;
 *   2. rejects the request with 409 if the client's `dayIndex` disagrees — the
 *      midnight-rollover guard, so a completion can never be applied to a
 *      challenge the courier did not play;
 *   3. calls `record_challenge_progress` with the GENERATED challenge's target,
 *      window, title and reward, so the payout is the server's number and not one
 *      supplied by the request.
 *
 * The submitted `progress` counter is clamped in SQL. That is the same trust model
 * the score route uses: the client reports a *fact about its own run*, the server
 * decides what that fact is worth (see `ARCHITECTURE.md` §12).
 *
 * `runtime = 'nodejs'` for PostgREST, and no caching: the payload is a function of
 * the current instant.
 */

export const runtime = 'nodejs';

export async function GET() {
  // `Date.now()` here is the Node process's clock — i.e. the server's, which is
  // the only clock allowed to decide which day it is.
  const today = await loadTodayChallenge();

  return NextResponse.json(
    {
      dayIndex: today.context.dayIndex,
      date: today.context.date,
      serverTimeMs: today.context.serverTimeMs,
      secondsUntilReset: today.context.secondsUntilReset,
      challenge: today.context.challenge,
      progress: today.progress,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Shape-check only: the reward, target and owner are all server-derived, so a
  // malformed body is a usability problem, never a security one.
  const validated = validateChallengeProgressSubmission(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const submission = validated.value;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  // Authenticate before doing any work, so an anonymous flooder cannot make the
  // database compute on their behalf.
  const user = await verifyUser(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // The day is decided here — the client's `dayIndex` is only compared to it.
  const context = buildDailyChallengeContext(Date.now());
  if (submission.dayIndex !== context.dayIndex) {
    return NextResponse.json(
      { error: 'The challenge day rolled over. Fetch today’s challenge.', dayIndex: context.dayIndex },
      { status: 409 }
    );
  }

  const { challenge } = context;

  try {
    const { data, error } = await supabase.rpc('record_challenge_progress', {
      p_challenge_id: challenge.id,
      p_day_index: challenge.dayIndex,
      p_metric: challenge.objective.metric,
      p_target: challenge.objective.target,
      p_window_seconds: challenge.objective.windowSeconds,
      p_title: challenge.title,
      p_description: challenge.description,
      p_reward_credits: challenge.reward.credits,
      p_reward_xp: challenge.reward.xp,
      // The only client-supplied number, clamped again inside the function.
      p_progress: submission.progress,
    });

    if (error) {
      // Logged, never returned: PostgREST text can disclose catalog internals.
      console.error('[api/challenges] record_challenge_progress:', error.message);
      return NextResponse.json({ error: 'Could not record challenge progress' }, { status: 500 });
    }

    // `returns table(...)` arrives as an array; tolerate a single object too.
    const row = (Array.isArray(data) ? data[0] : data) as
      | Database['public']['Functions']['record_challenge_progress']['Returns'][number]
      | undefined;

    if (!row) {
      return NextResponse.json({ error: 'Could not record challenge progress' }, { status: 500 });
    }

    const progress = challengeProgressFromRpc(row);

    return NextResponse.json(
      {
        status: 'recorded',
        progress: progress.progress,
        target: progress.target,
        completed: progress.completed,
        claimed: progress.claimed,
        // The authority on whether THIS response should pay the reward locally.
        newlyClaimed: Boolean(row.newly_claimed),
        rewardCredits: progress.rewardCredits,
        rewardXp: progress.rewardXp,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[api/challenges] failed:', error);
    return NextResponse.json({ error: 'Could not record challenge progress' }, { status: 503 });
  }
}
