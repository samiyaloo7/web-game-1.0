import { CheckCircle2, History, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChallengeHistoryEntry } from '@/game/types/challenge';

/**
 * A courier's challenge history.
 *
 * A Server Component with no state: the list arrives finished. Each row's
 * definition (title, objective, window, payout) is read back from the stored row
 * rather than regenerated from the current date, so editing the generator's
 * templates later cannot rewrite what a courier already played — the same reason
 * a receipt keeps the price it charged. `updatedAt` is the database's own stamp.
 */

/** One row's outcome, collapsed into the three states that matter to a player. */
function outcomeOf(entry: ChallengeHistoryEntry): {
  label: string;
  className: string;
} {
  if (entry.claimed) {
    return { label: 'PAID', className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' };
  }
  if (entry.completed) {
    return { label: 'PENDING', className: 'text-neon-amber border-neon-amber/30 bg-neon-amber/10' };
  }
  return { label: 'MISSED', className: 'text-zinc-500 border-cyber-border bg-cyber-surface/60' };
}

export function ChallengeHistory({ entries }: { entries: ChallengeHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="border border-cyber-border rounded-lg bg-cyber-dark/80 p-10 text-center">
        <History className="w-9 h-9 text-zinc-700 mx-auto mb-3" />
        <p className="text-white font-bold mb-1">NO CHALLENGE LOG</p>
        <p className="text-sm text-zinc-500 font-mono">
          Play a daily challenge while jacked in and the result is logged here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-cyber-border bg-cyber-dark/80 backdrop-blur-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-cyber-surface/90 text-xs text-zinc-400 uppercase tracking-wider border-b border-cyber-border">
          <tr>
            <th className="py-3 px-4 whitespace-nowrap">Day</th>
            <th className="py-3 px-4 whitespace-nowrap">Challenge</th>
            <th className="py-3 px-4 whitespace-nowrap">Result</th>
            <th className="py-3 px-4 whitespace-nowrap">Payout</th>
            <th className="py-3 px-4 whitespace-nowrap">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-cyber-border/50 text-zinc-300">
          {entries.map((entry) => {
            const outcome = outcomeOf(entry);
            const ratio = entry.target > 0 ? Math.min(1, entry.progress / entry.target) : 0;

            return (
              <tr key={entry.challengeId} className="hover:bg-cyber-surface/40 transition-colors">
                <td className="py-3 px-4 font-mono text-xs text-zinc-400 whitespace-nowrap">
                  {entry.date}
                </td>
                <td className="py-3 px-4">
                  <div className="font-bold text-white text-xs tracking-wide">{entry.title}</div>
                  <div className="text-[11px] text-zinc-500 font-mono">{entry.description}</div>
                </td>
                <td className="py-3 px-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">
                      {entry.progress}/{entry.target}
                    </span>
                    {entry.completed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <MinusCircle className="w-3.5 h-3.5 text-zinc-600" />
                    )}
                  </div>
                  <div className="mt-1 h-1 w-24 rounded bg-cyber-surface overflow-hidden">
                    <div
                      className={cn('h-full', entry.completed ? 'bg-emerald-400' : 'bg-neon-cyan/60')}
                      style={{ width: `${ratio * 100}%` }}
                    />
                  </div>
                </td>
                <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-neon-amber">
                  ¢{entry.rewardCredits} + {entry.rewardXp} XP
                </td>
                <td className="py-3 px-4 whitespace-nowrap">
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded border text-[11px] font-bold tracking-wide',
                      outcome.className
                    )}
                  >
                    {outcome.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
