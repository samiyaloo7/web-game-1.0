import { User, Shield, Zap, Wrench, Award, LogIn, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getCurrentUser } from "@/lib/auth/session";
import { loadCareerSummary, loadRecentScores } from "@/lib/progression/server";
import { reputationTier } from "@/lib/leaderboard/server";
import { UPGRADE_CATALOG } from "@/game/data/upgradeData";
import { computeEffectiveStats } from "@/game/systems/ProgressionMath";
import { DEFAULT_BASE_STATS } from "@/game/types/progression";

export const metadata = {
  title: "Courier Dossier // Neon Courier",
  description: "View player profile, equipped garage mods, and delivery statistics.",
};

// The dossier is per-courier and must never be cached or prerendered: a static
// render would either leak one courier's career to everyone or show stale ranks.
export const dynamic = 'force-dynamic';

/**
 * Courier dossier — a Server Component, so the career is read from Postgres on
 * the server (inside RLS) and rendered as finished HTML.
 *
 * The important detail: this page derives *nothing*. `player_progress.level` is
 * a generated column computed by Postgres, and the stat block comes from the
 * same pure `computeEffectiveStats` the simulation uses, so the dossier can
 * never disagree with the garage. React renders numbers it was given; the
 * rules live in the game and the database.
 */
export default async function ProfilePage() {
  const user = await getCurrentUser();

  if (!user) {
    const isConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
    return (
      <div className="flex-1 max-w-3xl mx-auto w-full p-4 sm:p-8">
        <div className="border border-cyber-border rounded-xl bg-cyber-dark/80 p-10 text-center backdrop-blur-sm">
          <CloudOff className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-white mb-2">NO CAREER ON FILE</h1>
          <p className="text-sm text-zinc-400 mb-6 max-w-md mx-auto">
            {isConfigured
              ? "Jack in to load your saved rank, wallet and garage."
              : "Supabase is not configured, so careers are local-only for now. Add the NEXT_PUBLIC_* variables to enable accounts."}
          </p>
          <Button href="/login" size="lg" className="mx-auto">
            <LogIn className="w-4 h-4 mr-2" /> Jack In
          </Button>
        </div>
      </div>
    );
  }

  const [career, recentScores] = await Promise.all([
    loadCareerSummary(),
    loadRecentScores(5),
  ]);

  const level = career?.level ?? 1;
  const money = career?.money ?? 0;
  const xp = career?.xp ?? 0;
  const upgrades = career?.upgrades ?? {};

  // Same pure function the simulation calls, so the dossier matches the garage.
  // Only money/xp/upgrades are needed; rank comes from the DB's generated column.
  const stats = computeEffectiveStats(
    { money, xp, upgrades },
    { base: DEFAULT_BASE_STATS, catalog: UPGRADE_CATALOG }
  );

  const owned = UPGRADE_CATALOG.filter((d) => (upgrades[d.id] ?? 0) > 0);
  const recentCredits = recentScores.reduce((sum, row) => sum + row.credits, 0);

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full p-4 sm:p-8">
      <div className="border border-cyber-border rounded-xl bg-cyber-dark/80 p-6 sm:p-8 backdrop-blur-sm mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-neon-cyan/10 border-2 border-neon-cyan/50 flex items-center justify-center text-neon-cyan shadow-sm">
              <User className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white tracking-wide">{user.username}</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan">
                  RANK {level}
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                REP TIER: {reputationTier(recentCredits).toUpperCase()} • SECTOR 04 COURIER
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-xs text-zinc-400 font-mono uppercase">Credits Stash</div>
              <div className="text-2xl font-bold text-neon-amber font-mono">
                ¢ {money.toLocaleString()}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-400 font-mono uppercase">Lifetime XP</div>
              <div className="text-2xl font-bold text-neon-cyan font-mono">
                {xp.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Garage Loadout + Recent Deliveries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="border border-cyber-border rounded-xl bg-cyber-dark/80 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between pb-4 border-b border-cyber-border mb-6">
            <div className="flex items-center gap-2 text-white font-bold">
              <Wrench className="w-4 h-4 text-neon-pink" />
              <span>EQUIPPED HOVERBIKE RIG</span>
            </div>
            <span className="text-xs text-neon-pink font-mono">
              {owned.length === 0 ? "STOCK CHASSIS" : `${owned.length} MODS`}
            </span>
          </div>

          <div className="space-y-4">
            {owned.length === 0 ? (
              <p className="text-sm text-zinc-500 font-mono">
                No modifications installed. Bank credits and visit the garage.
              </p>
            ) : (
              owned.map((definition) => {
                const ownedLevel = upgrades[definition.id] ?? 0;
                const Icon =
                  definition.category === "engine"
                    ? Zap
                    : definition.category === "shield"
                      ? Shield
                      : Wrench;
                return (
                  <div
                    key={definition.id}
                    className="p-3.5 rounded-lg border border-cyber-border bg-cyber-surface/60 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-neon-cyan shrink-0" />
                      <div>
                        <div className="text-sm font-semibold text-white">{definition.name}</div>
                        <div className="text-xs text-zinc-400">{definition.description}</div>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-neon-cyan shrink-0 ml-3">
                      Lv {ownedLevel}/{definition.maxLevel}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Derived stats — the same numbers the simulation applies to the run. */}
          <div className="mt-6 pt-6 border-t border-cyber-border grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xs text-zinc-400 font-mono">SPEED</div>
              <div className="text-lg font-bold text-neon-cyan font-mono">{stats.speed}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 font-mono">HULL</div>
              <div className="text-lg font-bold text-neon-amber font-mono">
                {stats.maxHealth}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400 font-mono">PAYOUT</div>
              <div className="text-lg font-bold text-neon-pink font-mono">
                x{stats.rewardMultiplier.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
        {/* Recent Deliveries */}
        <div className="border border-cyber-border rounded-xl bg-cyber-dark/80 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between pb-4 border-b border-cyber-border mb-6">
            <div className="flex items-center gap-2 text-white font-bold">
              <Award className="w-4 h-4 text-neon-amber" />
              <span>RECENT DELIVERIES</span>
            </div>
            <span className="text-xs text-zinc-500 font-mono">
              {recentScores.length} LOGGED
            </span>
          </div>

          {recentScores.length === 0 ? (
            <p className="text-sm text-zinc-500 font-mono">
              No logged deliveries yet. Complete a run to start a record.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentScores.map((score) => (
                <li
                  key={score.id}
                  className="flex items-center justify-between gap-2 py-2 px-3 rounded bg-cyber-surface/50 border border-cyber-border"
                >
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border shrink-0 ${
                      score.status === "completed"
                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                        : "border-neon-pink/40 text-neon-pink bg-neon-pink/10"
                    }`}
                  >
                    {score.status === "completed" ? "DELIVERED" : "FAILED"}
                  </span>
                  <span className="text-sm font-mono text-neon-amber">
                    &cent;{score.credits.toLocaleString()}
                  </span>
                  <span className="text-xs font-mono text-neon-cyan">+{score.xp} XP</span>
                  <span className="text-xs font-mono text-zinc-500 shrink-0">
                    {Math.round(score.time_seconds)}s
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

