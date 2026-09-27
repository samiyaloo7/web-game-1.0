import { Trophy, Medal, Award, Flame } from "lucide-react";

export const metadata = {
  title: "Global Leaderboards // Neon Courier",
  description: "Top courier times and delivery rankings across the neon sprawl.",
};

interface LeaderboardEntry {
  rank: number;
  courier: string;
  deliveries: number;
  credits: number;
  reputation: string;
}

const mockRankings: LeaderboardEntry[] = [
  { rank: 1, courier: "CYBER_GHOST_99", deliveries: 248, credits: 89450, reputation: "Legendary" },
  { rank: 2, courier: "NULL_POINTER_X", deliveries: 215, credits: 74200, reputation: "Master" },
  { rank: 3, courier: "NEON_VIPER", deliveries: 198, credits: 68100, reputation: "Elite" },
  { rank: 4, courier: "SYNTH_DRIFTER", deliveries: 172, credits: 54900, reputation: "Veteran" },
  { rank: 5, courier: "ROOKIE_KID", deliveries: 145, credits: 42100, reputation: "Operator" },
];

export default function LeaderboardPage() {
  return (
    <div className="flex-1 max-w-5xl mx-auto w-full p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-cyber-border mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 text-neon-amber text-xs font-mono uppercase tracking-wider mb-1">
            <Flame className="w-4 h-4" />
            <span>Syndicate High Frequency Rankings</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">CITYWIDE DISPATCH BOARD</h1>
        </div>
        <div className="text-xs text-zinc-400 bg-cyber-surface px-3 py-1.5 rounded border border-cyber-border font-mono">
          REFRESH: REALTIME VIA SUPABASE
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-cyber-border bg-cyber-dark/80 backdrop-blur-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-cyber-surface/90 text-xs text-zinc-400 uppercase tracking-wider border-b border-cyber-border">
            <tr>
              <th className="py-3 px-4">Rank</th>
              <th className="py-3 px-4">Courier Call-Sign</th>
              <th className="py-3 px-4">Completed Runs</th>
              <th className="py-3 px-4">Street Credits</th>
              <th className="py-3 px-4">Rep Tier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cyber-border/50 text-zinc-300">
            {mockRankings.map((item) => (
              <tr key={item.courier} className="hover:bg-cyber-surface/40 transition-colors">
                <td className="py-3.5 px-4 font-mono font-bold">
                  {item.rank === 1 && <Trophy className="inline w-4 h-4 text-neon-amber mr-1.5" />}
                  {item.rank === 2 && <Medal className="inline w-4 h-4 text-slate-300 mr-1.5" />}
                  {item.rank === 3 && <Award className="inline w-4 h-4 text-amber-600 mr-1.5" />}
                  #{item.rank}
                </td>
                <td className="py-3.5 px-4 font-semibold text-white tracking-wide">
                  {item.courier}
                </td>
                <td className="py-3.5 px-4 font-mono text-neon-cyan">{item.deliveries}</td>
                <td className="py-3.5 px-4 font-mono text-neon-amber">
                  ¢ {item.credits.toLocaleString()}
                </td>
                <td className="py-3.5 px-4">
                  <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium border border-cyber-border bg-cyber-surface text-zinc-300">
                    {item.reputation}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
