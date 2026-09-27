"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap, Gamepad2, Trophy, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: "Dispatch (Play)", href: "/game", icon: Gamepad2 },
  { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
  { label: "Courier ID", href: "/profile", icon: User },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-cyber-border/80 bg-cyber-black/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="p-1.5 rounded bg-neon-cyan/10 border border-neon-cyan/40 text-neon-cyan group-hover:scale-105 transition-transform">
            <Zap className="w-5 h-5" />
          </div>
          <span className="font-extrabold tracking-widest text-lg text-white group-hover:text-neon-cyan transition-colors">
            NEON<span className="text-neon-pink">COURIER</span>
          </span>
        </Link>

        {/* Navigation Links */}
        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium tracking-wide transition-all",
                  isActive
                    ? "bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40 shadow-sm"
                    : "text-zinc-400 hover:text-white hover:bg-cyber-surface/60"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-neon-cyan" : "text-zinc-400")} />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
