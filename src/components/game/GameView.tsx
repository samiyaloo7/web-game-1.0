'use client';

import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';

/**
 * GameView encapsulates the Phaser 3 canvas lifecycle.
 * It mounts Phaser strictly in the browser on client mount,
 * and performs clean disposal when unmounting to prevent WebGL context leaks.
 */
export function GameView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function initPhaser() {
      if (!containerRef.current || gameRef.current) return;

      try {
        const PhaserModule = await import('phaser');
        const { createGameConfig } = await import('@/game/config');

        // Prevent instantiating if the component unmounted while importing
        if (isCancelled || !containerRef.current) return;

        const config = createGameConfig(containerRef.current);
        gameRef.current = new PhaserModule.Game(config);
        setIsReady(true);
      } catch (err) {
        console.error('Failed to initialize Phaser game engine:', err);
      }
    }

    void initPhaser();

    return () => {
      isCancelled = true;
      if (gameRef.current) {
        // destroy(true): removes canvas from DOM and frees WebGL / Audio contexts
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full aspect-[16/9] max-w-5xl rounded-lg overflow-hidden border border-cyber-border bg-[#0a0c14] shadow-2xl">
      {/* Phaser Canvas Mount Point */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center"
      />

      {/* Overlay status indicator */}
      {!isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-cyber-black/90 text-neon-cyan font-mono text-sm gap-3 z-10">
          <div className="w-6 h-6 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
          <span>INITIALIZING SIMULATION ENGINE...</span>
        </div>
      )}
    </div>
  );
}
