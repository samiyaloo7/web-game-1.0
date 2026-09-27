import { User, Shield, Zap, Wrench, Award, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const metadata = {
  title: "Courier Dossier // Neon Courier",
  description: "View player profile, equipped garage mods, and delivery statistics.",
};

export default function ProfilePage() {
  return (
    <div className="flex-1 max-w-5xl mx-auto w-full p-4 sm:p-8">
      {/* Profile Header */}
      <div className="border border-cyber-border rounded-xl bg-cyber-dark/80 p-6 sm:p-8 backdrop-blur-sm mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-neon-cyan/10 border-2 border-neon-cyan/50 flex items-center justify-center text-neon-cyan shadow-sm">
              <User className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white tracking-wide">OPERATOR_01</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan">
                  LOCAL PILOT
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                ID: NC-8849-ALPHA • SECTOR 04 REPUTATION: LEVEL 3
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-xs text-zinc-400 font-mono uppercase">Credits Stash</div>
              <div className="text-2xl font-bold text-neon-amber font-mono">¢ 1,450</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-400 font-mono uppercase">Delivery XP</div>
              <div className="text-2xl font-bold text-neon-cyan font-mono">3,890</div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Garage Loadout + Lifetime Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Equipped Garage Rig */}
        <div className="border border-cyber-border rounded-xl bg-cyber-dark/80 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between pb-4 border-b border-cyber-border mb-6">
            <div className="flex items-center gap-2 text-white font-bold">
              <Wrench className="w-4 h-4 text-neon-pink" />
              <span>EQUIPPED HOVERBIKE RIG</span>
            </div>
            <span className="text-xs text-neon-pink font-mono">STOCK CHASSIS</span>
          </div>

          <div className="space-y-4">
            <div className="p-3.5 rounded-lg border border-cyber-border bg-cyber-surface/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-neon-cyan" />
                <div>
                  <div className="text-sm font-semibold text-white">Ion Turbine Mk I</div>
                  <div className="text-xs text-zinc-400">Engine • +15% Boost Speed</div>
                </div>
              </div>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>

            <div className="p-3.5 rounded-lg border border-cyber-border bg-cyber-surface/60 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-neon-amber" />
                <div>
                  <div className="text-sm font-semibold text-white">Polymer Kinetic Plating</div>
                  <div className="text-xs text-zinc-400">Armor • 100 Max Hull Integrity</div>
                </div>
              </div>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-cyber-border flex justify-end">
            <Button variant="outline" size="sm">
              Open Garage Mod Shop
            </Button>
          </div>
        </div>

        {/* Lifetime Record */}
        <div className="border border-cyber-border rounded-xl bg-cyber-dark/80 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-2 pb-4 border-b border-cyber-border mb-6 text-white font-bold">
            <Award className="w-4 h-4 text-neon-amber" />
            <span>DISPATCH SERVICE RECORD</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-cyber-surface/60 border border-cyber-border">
              <div className="text-xs text-zinc-400 font-mono">COMPLETED RUNS</div>
              <div className="text-xl font-bold font-mono text-white mt-1">12</div>
            </div>
            <div className="p-4 rounded-lg bg-cyber-surface/60 border border-cyber-border">
              <div className="text-xs text-zinc-400 font-mono">SUCCESS RATE</div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1">92.3%</div>
            </div>
            <div className="p-4 rounded-lg bg-cyber-surface/60 border border-cyber-border">
              <div className="text-xs text-zinc-400 font-mono">AVG TRANSIT TIME</div>
              <div className="text-xl font-bold font-mono text-neon-cyan mt-1">42.8s</div>
            </div>
            <div className="p-4 rounded-lg bg-cyber-surface/60 border border-cyber-border">
              <div className="text-xs text-zinc-400 font-mono">HULL LOSS INCIDENTS</div>
              <div className="text-xl font-bold font-mono text-neon-pink mt-1">1</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
