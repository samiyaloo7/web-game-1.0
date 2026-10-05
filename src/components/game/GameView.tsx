'use client';

import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import { GameHudStats } from './GameHudStats';
import { GameHudMission } from './GameHudMission';
import { GameHudControls } from './GameHudControls';
import { GameHudAudio } from './GameHudAudio';
import { GameHudVitals } from './GameHudVitals';
import { GameHudChallenge } from './GameHudChallenge';
import { GameOverOverlay } from './GameOverOverlay';
import { PauseOverlay } from './PauseOverlay';
import { useGameBridge } from '@/hooks/useGameBridge';
import { useHudOcclusion } from '@/hooks/useHudOcclusion';
import { useAudioSettings } from '@/hooks/useAudioSettings';
import { useProgressionSync } from '@/hooks/useProgressionSync';
import { useScoreReporting } from '@/hooks/useScoreReporting';
import { useDailyChallenge } from '@/hooks/useDailyChallenge';

/**
 * Reads an optional `?seed=` query param so a generated district can be shared or
 * reproduced. Numeric seeds arrive as numbers; anything else is hashed as a string.
 */
function readSeedFromUrl(): number | string | undefined {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null || raw.trim() === '') return undefined;

  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

/**
 * GameView encapsulates the Phaser 3 canvas and layers
 * the reactive Tailwind HUD on top of the simulation.
 */
export function GameView() {
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * Wraps both the canvas and the HUD panels: the measurement and the coordinate
   * origin for occlusion have to span both, since the canvas establishes the scale
   * and the panels are its siblings, not its children.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Mount EventBus listener bridge
  useGameBridge();

  // Report where the HUD panels actually rendered, so the scene can tell when one of
  // them is covering the parcel or the drop pad.
  useHudOcclusion(rootRef);

  // Hydrate the audio preferences, push edits into the engine, and offer the first
  // user gesture to the browser's autoplay policy.
  useAudioSettings();

  // Hydrate the career from Supabase on mount and persist changes back.
  // No-ops entirely for guests, so an unconfigured project still plays.
  useProgressionSync();

  // Report finished deliveries to the leaderboard. Also a no-op for guests.
  useScoreReporting();

  // Ask the server which challenge today is, push it into the simulation, and
  // record the outcome. The clock authority is the server; see the hook.
  useDailyChallenge();

  useEffect(() => {
    let isCancelled = false;

    async function initPhaser() {
      if (!containerRef.current || gameRef.current) return;

      try {
        const PhaserModule = await import('phaser');
        const { createGameConfig } = await import('@/game/config');

        if (isCancelled || !containerRef.current) return;

        // `?seed=` lets a district be shared, replayed, or debugged by URL.
        const config = createGameConfig(containerRef.current, { seed: readSeedFromUrl() });
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
    <div
      ref={rootRef}
      className="relative w-full aspect-[16/9] max-w-5xl rounded-lg overflow-hidden border border-cyber-border bg-[#0a0c14] shadow-2xl select-none"
    >
      {/* 1. Phaser Canvas Mount Layer (z-0) */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center relative z-0"
      />

      {/* 2. Top HUD Bar Overlay (z-20) */}
      <div className="absolute top-3 left-3 right-3 z-20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pointer-events-none">
        {/* Left: Mission Objectives & Target */}
        <div className="pointer-events-auto w-full sm:w-auto flex flex-col gap-2">
          <GameHudMission />
          <GameHudVitals />
        </div>

        {/* Right: Currency / XP / Score, Controls & Audio */}
        <div className="pointer-events-auto flex flex-col items-end gap-2 w-full sm:w-auto">
          <GameHudStats />
          <GameHudControls />
          <GameHudAudio />
        </div>
      </div>

      {/* 3. Daily challenge panel (z-20). Bottom-left, clear of the top HUD stack,
             and narrow enough not to cover the drop pad on a laptop viewport. */}
      <div className="absolute bottom-3 left-3 z-20 w-[calc(100%-1.5rem)] sm:w-80 pointer-events-auto">
        <GameHudChallenge />
      </div>

      {/* 4. Pause / Game Over Overlays (z-30) */}
      <PauseOverlay />
      <GameOverOverlay />

      {/* 5. Engine Loading Fallback */}
      {!isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-cyber-black/90 text-neon-cyan font-mono text-sm gap-3 z-40">
          <div className="w-6 h-6 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
          <span>ESTABLISHING NEURAL SIMULATION LINK...</span>
        </div>
      )}
    </div>
  );
}

