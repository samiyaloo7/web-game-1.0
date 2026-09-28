import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { AuthForm } from '@/components/auth/AuthForm';
import { getCurrentUser } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Courier Access // Neon Courier',
  description: 'Sign in or register a call-sign to persist your career across sessions.',
};

/**
 * Login / signup page.
 *
 * A Server Component so the "already signed in?" check happens before any HTML
 * is sent — no flash of a login form for an authenticated courier. Note this
 * page is deliberately NOT protected: it is the entry point to auth, so the
 * `proxy` performs no redirect and every other route keeps its own guard.
 */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect('/game');
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md">
        <div className="border border-cyber-border rounded-xl bg-cyber-dark/80 backdrop-blur-md relative overflow-hidden">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-neon-cyan pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-neon-pink pointer-events-none" />

          <div className="flex items-center gap-3 p-6 border-b border-cyber-border">
            <div className="p-2.5 rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-wide">COURIER ACCESS</h1>
              <p className="text-xs text-zinc-400 font-mono">SYNDICATE NETWORK TERMINAL</p>
            </div>
          </div>

          <div className="p-6">
            <AuthForm />
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-500 font-mono">
          Progress saves automatically once you register. Guests play on a local-only profile.
        </p>
      </div>
    </div>
  );
}
