'use client';

import dynamic from 'next/dynamic';

/**
 * GameContainer uses dynamic import with ssr: false.
 * This guarantees that Next.js never evaluates Phaser during server-side pre-rendering
 * where `window`, `document`, and `WebGLRenderingContext` are undefined.
 */
export const GameContainer = dynamic(
  () => import('./GameView').then((mod) => mod.GameView),
  {
    ssr: false,
    loading: () => (
      <div className="w-full aspect-[16/9] max-w-5xl rounded-lg border border-cyber-border bg-cyber-dark/80 flex flex-col items-center justify-center font-mono text-zinc-400 gap-3">
        <div className="w-6 h-6 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
        <span>LOADING NEURAL LINK...</span>
      </div>
    ),
  }
);
