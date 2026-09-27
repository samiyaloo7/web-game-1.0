'use client';

import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import { GameHudStats } from './GameHudStats';
import { GameHudMission } from './GameHudMission';
import { GameHudControls } from './GameHudControls';
import { PauseOverlay } from './PauseOverlay';
import { useGameBridge } from '@/hooks/useGameBridge';

/**
 * GameView encapsulates the Phaser 3 canvas and layers
 * the reactive Tailwind HUD on top of the simulation.
 */
export function GameView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Mount EventBus listener bridge
  useGameBridge();

  useEffect(() => {
    let isCancelled = false;

    async function initPhaser() {
      if (!containerRef.current || gameRef.current) return;

      try {
        const PhaserModule = await import('phaser');
        const { createGameConfig } = await import('@/game/config');

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
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full aspect-[16/9] max-w-5xl rounded-lg overflow-hidden border border-cyber-border bg-[#0a0c14] shadow-2xl select-none">
      {/* 1. Phaser Canvas Mount Layer (z-0) */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center relative z-0"
      />

      {/* 2. Top HUD Bar Overlay (z-20) */}
      <div className="absolute top-3 left-3 right-3 z-20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pointer-events-none">
        {/* Left: Mission Objectives & Target */}
        <div className="pointer-events-auto w-full sm:w-auto">
          <GameHudMission />
        </div>

        {/* Right: Currency / XP / Score & Controls */}
        <div className="pointer-events-auto flex flex-col items-end gap-2 w-full sm:w-auto">
          <GameHudStats />
          <GameHudControls />
        </div>
      </div>

      {/* 3. Pause Overlay (z-30) */}
      <PauseOverlay />

      {/* 4. Engine Loading Fallback */}
      {!isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-cyber-black/90 text-neon-cyan font-mono text-sm gap-3 z-40">
          <div className="w-6 h-6 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
          <span>ESTABLISHING NEURAL SIMULATION LINK...</span>
        </div>
      )}
    </div>
  );
}

