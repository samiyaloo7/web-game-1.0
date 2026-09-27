import { Button } from "@/components/ui/Button";
import { Gamepad2, ArrowLeft, ShieldCheck, Zap } from "lucide-react";

export const metadata = {
  title: "Dispatch Console // Neon Courier",
  description: "Mission launch portal and active delivery simulation display.",
};

export default function GamePage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-4xl border border-cyber-border rounded-xl bg-cyber-dark/80 p-6 sm:p-10 backdrop-blur-md relative overflow-hidden">
        {/* Accent corner lines */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-neon-cyan" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-neon-pink" />

        <div className="flex items-center justify-between pb-6 border-b border-cyber-border mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan">
              <Gamepad2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-wide">
                DISPATCH INTERFACE
              </h1>
              <p className="text-xs text-zinc-400">SECTOR 04 - METRO RUNNER TERMINAL</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-cyber-surface border border-emerald-500/30 text-emerald-400 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>STANDBY</span>
          </div>
        </div>

        {/* Game Canvas Placeholder Frame */}
        <div className="w-full h-80 sm:h-96 rounded-lg border-2 border-dashed border-cyber-border bg-cyber-black/70 flex flex-col items-center justify-center text-center p-6 relative group">
          <div className="p-4 rounded-full bg-neon-cyan/5 border border-neon-cyan/20 text-neon-cyan mb-4 group-hover:scale-110 transition-transform">
            <Zap className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">PHASER SIMULATION CANVAS</h2>
          <p className="text-sm text-zinc-400 max-w-md">
            The Phaser 3 2D rendering viewport will mount here in Step 2. High-speed physics, arcade collisions, and neon particles will render in this viewport.
          </p>
          <div className="mt-6 flex items-center gap-4 text-xs font-mono text-zinc-500">
            <span>RES: 1280x720</span>
            <span>•</span>
            <span>FPS TARGET: 60</span>
            <span>•</span>
            <span>RENDERER: WEBGL</span>
          </div>
        </div>

        {/* Pre-flight Check Info */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded bg-cyber-surface/60 border border-cyber-border flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-neon-cyan" />
            <div>
              <div className="text-xs text-zinc-400">VEHICLE HULL</div>
              <div className="text-sm font-semibold text-white">Stock Courier (100 HP)</div>
            </div>
          </div>

          <div className="p-4 rounded bg-cyber-surface/60 border border-cyber-border flex items-center gap-3">
            <Zap className="w-5 h-5 text-neon-amber" />
            <div>
              <div className="text-xs text-zinc-400">ENGINE CLASS</div>
              <div className="text-sm font-semibold text-white">Turbine Mk1 (Standard)</div>
            </div>
          </div>

          <div className="p-4 rounded bg-cyber-surface/60 border border-cyber-border flex items-center gap-3">
            <Gamepad2 className="w-5 h-5 text-neon-pink" />
            <div>
              <div className="text-xs text-zinc-400">CONTROLS</div>
              <div className="text-sm font-semibold text-white">WASD / Arrow Keys</div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-between items-center pt-6 border-t border-cyber-border">
          <Button href="/" variant="outline" size="sm" className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Menu</span>
          </Button>

          <Button variant="primary" size="md">
            Initiate Boot Sequence
          </Button>
        </div>
      </div>
    </div>
  );
}
