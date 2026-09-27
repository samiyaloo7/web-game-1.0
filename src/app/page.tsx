import { Button } from "@/components/ui/Button";
import { Package, ShieldAlert, Cpu, ChevronRight, Sparkles } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex-1 flex flex-col justify-center items-center px-4 py-16 sm:py-24 relative overflow-hidden">
      {/* Background neon grid glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-neon-cyan/10 blur-[130px] pointer-events-none rounded-full" />
      <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-neon-pink/10 blur-[100px] pointer-events-none rounded-full" />

      {/* Hero Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neon-cyan/30 bg-cyber-surface/70 text-neon-cyan text-xs tracking-wider uppercase mb-8 backdrop-blur-sm">
        <Sparkles className="w-3.5 h-3.5" />
        <span>System Status: Online // Sector 7 Active</span>
      </div>

      {/* Main Title */}
      <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-center max-w-4xl text-white">
        DELIVER FAST. <br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan via-white to-neon-pink neon-text-cyan">
          SURVIVE THE NIGHT.
        </span>
      </h1>

      {/* Subtitle */}
      <p className="mt-6 text-zinc-400 text-center max-w-xl text-base sm:text-lg leading-relaxed">
        Pilot high-velocity hoverbikes through rain-soaked neon alleys. Outmaneuver syndicate drones, deliver illicit cargo, and customize your cybernetic ride.
      </p>

      {/* CTA Buttons */}
      <div className="mt-10 flex flex-col sm:flex-row items-center gap-4 w-full max-w-xs sm:max-w-none justify-center">
        <Button href="/game" size="lg" className="w-full sm:w-auto flex items-center gap-2 group">
          <span>Launch Mission</span>
          <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </Button>
        <Button href="/leaderboard" variant="outline" size="lg" className="w-full sm:w-auto">
          View High Scores
        </Button>
      </div>

      {/* Features preview */}
      <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
        <div className="p-6 rounded-lg border border-cyber-border bg-cyber-surface/50 backdrop-blur-sm hover:border-neon-cyan/50 transition-colors">
          <div className="p-3 w-fit rounded bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan mb-4">
            <Package className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">High-Stakes Dispatch</h2>
          <p className="text-sm text-zinc-400">
            Pick up urgent packages with tight deadlines and fragile cargo modifiers across sprawling city sectors.
          </p>
        </div>

        <div className="p-6 rounded-lg border border-cyber-border bg-cyber-surface/50 backdrop-blur-sm hover:border-neon-pink/50 transition-colors">
          <div className="p-3 w-fit rounded bg-neon-pink/10 border border-neon-pink/20 text-neon-pink mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Dynamic Threats</h2>
          <p className="text-sm text-zinc-400">
            Dodge autonomous police drones, laser barricades, and heavy congestion in a high-speed arcade simulation.
          </p>
        </div>

        <div className="p-6 rounded-lg border border-cyber-border bg-cyber-surface/50 backdrop-blur-sm hover:border-neon-amber/50 transition-colors">
          <div className="p-3 w-fit rounded bg-neon-amber/10 border border-neon-amber/20 text-neon-amber mb-4">
            <Cpu className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Garage & Mod Shop</h2>
          <p className="text-sm text-zinc-400">
            Spend earned street credits on ion thrusters, electromagnetic shielding, and oversized cargo containers.
          </p>
        </div>
      </div>
    </div>
  );
}

