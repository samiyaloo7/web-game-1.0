'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, UserPlus, KeyRound, AtSign, Hash } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { Button } from '@/components/ui/Button';

/**
 * Combined sign-in / sign-up form.
 *
 * Both modes live in one component because they share the same fields, the same
 * error surface and the same redirect — and a single mount means switching modes
 * never loses a half-typed email. Validation is intentionally duplicated from
 * `@/lib/validation` here *only* for immediate feedback; the server re-runs the
 * exact same rules, and the server copy is the one that counts.
 */
export function AuthForm({ defaultMode = 'login' }: { defaultMode?: 'login' | 'signup' }) {
  const { login, register, isConfigured } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'login' | 'signup'>(defaultMode);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        const result = await login(email, password);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.push('/game');
        router.refresh();
        return;
      }

      const result = await register(username, email, password);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.needsEmailConfirmation) {
        setNotice('Account created. Check your inbox to confirm the address, then sign in.');
        setMode('login');
        return;
      }
      router.push('/game');
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isConfigured) {
    return (
      <div className="border border-neon-amber/40 bg-neon-amber/10 rounded-lg p-4 text-sm text-neon-amber">
        <p className="font-bold mb-1">UPLINK NOT CONFIGURED</p>
        <p className="text-xs opacity-80">
          Add <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{' '}
          <code className="font-mono">.env.local</code> to enable courier accounts. The game
          still runs as a local-only session.
        </p>
      </div>
    );
  }

  const inputClass =
    'w-full bg-cyber-black/70 border border-cyber-border rounded px-3 py-2.5 text-sm text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-neon-cyan/70 transition-colors';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'signup' && (
        <div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono uppercase mb-1.5">
            <Hash className="w-3.5 h-3.5" /> Call-Sign
          </label>
          <input
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="NEO_VIPER"
            autoComplete="username"
            maxLength={20}
            required
          />
        </div>
      )}

      <div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono uppercase mb-1.5">
          <AtSign className="w-3.5 h-3.5" /> Email
        </label>
        <input
          className={inputClass}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="courier@nightcity.net"
          autoComplete="email"
          required
        />
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono uppercase mb-1.5">
          <KeyRound className="w-3.5 h-3.5" /> Password
        </label>
        <input
          className={inputClass}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={6}
          required
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-neon-pink font-mono border border-neon-pink/40 bg-neon-pink/10 rounded px-3 py-2">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-neon-cyan font-mono border border-neon-cyan/40 bg-neon-cyan/10 rounded px-3 py-2">
          {notice}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {mode === 'login' ? (
          <>
            <LogIn className="w-4 h-4 mr-2" /> {isSubmitting ? 'Authenticating…' : 'Jack In'}
          </>
        ) : (
          <>
            <UserPlus className="w-4 h-4 mr-2" /> {isSubmitting ? 'Creating…' : 'Create Account'}
          </>
        )}
      </Button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'signup' : 'login');
          setError(null);
          setNotice(null);
        }}
        className="w-full text-xs text-zinc-400 hover:text-neon-cyan font-mono uppercase tracking-wider transition-colors"
      >
        {mode === 'login' ? 'No account? Register a call-sign' : 'Already registered? Sign in'}
      </button>
    </form>
  );
}
