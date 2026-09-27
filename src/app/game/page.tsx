import { Gamepad2, ArrowLeft, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GameContainer } from "@/components/game/GameContainer";

export const metadata = {
  title: "Dispatch Console // Neon Courier",
  description: "Mission launch portal and active delivery simulation display.",
};

export default function GamePage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl border border-cyber-border rounded-xl bg-cyber-dark/80 p-6 sm:p-8 backdrop-blur-md relative overflow-hidden">
        {/* Accent corner lines */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-neon-cyan pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-neon-pink pointer-events-none" />

        {/* Console Header */}
        <div className="flex items-center justify-between pb-6 border-b border-cyber-border mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan">
              <Gamepad2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-wide">
                DISPATCH INTERFACE
              </h1>
              <p className="text-xs text-zinc-400 font-mono">SECTOR 04 - METRO RUNNER TERMINAL</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-cyber-surface border border-emerald-500/30 text-emerald-400 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>SIMULATION LIVE</span>
          </div>
        </div>

        {/* Live Phaser 3 Game Canvas Viewport */}
        <div className="flex justify-center w-full my-2">
          <GameContainer />
        </div>

        {/* Pre-flight Check Info */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded bg-cyber-surface/60 border border-cyber-border flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-neon-cyan" />
            <div>
              <div className="text-xs text-zinc-400 font-mono">VEHICLE HULL</div>
              <div className="text-sm font-semibold text-white">Stock Courier (100 HP)</div>
            </div>
          </div>

          <div className="p-4 rounded bg-cyber-surface/60 border border-cyber-border flex items-center gap-3">
            <Zap className="w-5 h-5 text-neon-amber" />
            <div>
              <div className="text-xs text-zinc-400 font-mono">THRUSTER DRAG</div>
              <div className="text-sm font-semibold text-white">Momentum Damping (0.85)</div>
            </div>
          </div>

          <div className="p-4 rounded bg-cyber-surface/60 border border-cyber-border flex items-center gap-3">
            <Gamepad2 className="w-5 h-5 text-neon-pink" />
            <div>
              <div className="text-xs text-zinc-400 font-mono">CONTROLS</div>
              <div className="text-sm font-semibold text-white">WASD / Arrow Keys</div>
            </div>
          </div>
        </div>

        {/* Navigation Actions */}
        <div className="mt-6 flex justify-between items-center pt-6 border-t border-cyber-border">
          <Button href="/" variant="outline" size="sm" className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Menu</span>
          </Button>

          <Button href="/profile" variant="ghost" size="sm">
            View Courier Dossier
          </Button>
        </div>
      </div>
    </div>
  );
}

