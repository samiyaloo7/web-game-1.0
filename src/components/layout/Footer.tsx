import Link from "next/link";
import { Terminal } from "lucide-react";

export function Footer() {
  return (
    <footer className="w-full border-t border-cyber-border/80 bg-cyber-black/90 py-6 text-xs text-zinc-500">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-neon-cyan" />
          <span>NEON COURIER // SYSTEM OS v0.1.0-ALPHA</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/game" className="hover:text-neon-cyan transition-colors">
            Dispatch
          </Link>
          <Link href="/leaderboard" className="hover:text-neon-cyan transition-colors">
            Leaderboard
          </Link>
          <Link href="/profile" className="hover:text-neon-cyan transition-colors">
            Courier ID
          </Link>
        </div>
      </div>
    </footer>
  );
}
