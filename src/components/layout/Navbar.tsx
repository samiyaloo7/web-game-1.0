"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Zap, Gamepad2, Trophy, User, LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";

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
  const router = useRouter();
  const { user, isLoading, isConfigured, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push("/");
    router.refresh();
  }

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
        {/* Auth controls. While the session check is in flight the slot holds its
            width instead of flashing a "Sign in" link at an already-signed-in user. */}
        <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:ml-4 pl-3 sm:pl-4 border-l border-cyber-border/70">
          {isLoading ? (
            <div className="w-20 h-8" aria-hidden />
          ) : user ? (
            <>
              <Link
                href="/profile"
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono text-neon-cyan border border-neon-cyan/30 bg-neon-cyan/10 hover:bg-neon-cyan/20 transition-colors"
              >
                <User className="w-3.5 h-3.5" />
                <span className="max-w-[10rem] truncate">{user.username}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono text-zinc-400 hover:text-neon-pink border border-transparent hover:border-neon-pink/30 transition-colors"
                title="Disconnect from the syndicate network"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Jack Out</span>
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition-colors",
                isConfigured
                  ? "text-neon-cyan border border-neon-cyan/40 hover:bg-neon-cyan/10"
                  : "text-zinc-500 border border-cyber-border hover:text-zinc-300"
              )}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isConfigured ? "Jack In" : "Offline"}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
