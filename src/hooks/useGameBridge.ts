'use client';

import { useEffect, useCallback } from 'react';
import { EventBus, GameToUiEvents } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';

/**
 * useGameBridge wires Phaser EventBus events into the Zustand store
 * and provides dispatch helpers to send commands back into Phaser.
 */
export function useGameBridge() {
  const setMission = useGameStore((s) => s.setMission);
  const setTimerTick = useGameStore((s) => s.setTimerTick);
  const setStats = useGameStore((s) => s.setStats);
  const setProgression = useGameStore((s) => s.setProgression);
  const setCity = useGameStore((s) => s.setCity);
  const setVitals = useGameStore((s) => s.setVitals);
  const setThreat = useGameStore((s) => s.setThreat);
  const setRunState = useGameStore((s) => s.setRunState);
  const setIsPaused = useGameStore((s) => s.setIsPaused);
  const setIsEngineReady = useGameStore((s) => s.setIsEngineReady);
  const setOccludedPanelIds = useGameStore((s) => s.setOccludedPanelIds);

  useEffect(() => {
    const handleMission = (data: GameToUiEvents['mission:updated']) => {
      setMission(data);
    };

    const handleTick = (data: GameToUiEvents['mission:tick']) => {
      setTimerTick(data.remainingTimeSeconds);
    };

    const handleStats = (data: GameToUiEvents['stats:updated']) => {
      setStats(data);
    };

    /** Career snapshots are emitted only on real progression changes — never per frame. */
    const handleProgression = (data: GameToUiEvents['progression:updated']) => {
      setProgression(data);
    };

    const handleCity = (data: GameToUiEvents['city:generated']) => {
      setCity(data);
    };

    const handleHealth = (data: GameToUiEvents['player:health-changed']) => {
      setVitals(data);
    };

    /**
     * Threat summaries are pre-quantised by `DroneDirector` precisely so this handler can
     * write straight into React state. Never raise the emit rate without re-reading the
     * "React render shielding" note in `ARCHITECTURE.md`.
     */
    const handleThreat = (data: GameToUiEvents['enemy:threat-changed']) => {
      setThreat(data);
    };

    const handleRunState = (data: GameToUiEvents['game:run-state-changed']) => {
      setRunState(data);
    };

    const handlePaused = (data: GameToUiEvents['game:paused-changed']) => {
      setIsPaused(data.isPaused);
    };

    /**
     * Which HUD panels are covering the objective. The scene computes this from pure
     * geometry and emits only when the *set* changes, so this can write straight into
     * React state without reintroducing per-frame renders.
     */
    const handleOcclusion = (data: GameToUiEvents['hud:occlusion-changed']) => {
      setOccludedPanelIds(data.occludedPanelIds);
    };

    const handleReady = () => {
      setIsEngineReady(true);
    };

    const handleDestroyed = () => {
      setIsEngineReady(false);
      // With the simulation gone there is nothing left to be covering, so the panels
      // must not stay stuck at low opacity.
      setOccludedPanelIds([]);
    };

    EventBus.onEvent('mission:updated', handleMission);
    EventBus.onEvent('mission:tick', handleTick);
    EventBus.onEvent('stats:updated', handleStats);
    EventBus.onEvent('progression:updated', handleProgression);
    EventBus.onEvent('city:generated', handleCity);
    EventBus.onEvent('player:health-changed', handleHealth);
    EventBus.onEvent('enemy:threat-changed', handleThreat);
    EventBus.onEvent('game:run-state-changed', handleRunState);
    EventBus.onEvent('game:paused-changed', handlePaused);
    EventBus.onEvent('hud:occlusion-changed', handleOcclusion);
    EventBus.onEvent('game:ready', handleReady);
    EventBus.onEvent('game:destroyed', handleDestroyed);

    return () => {
      EventBus.offEvent('mission:updated', handleMission);
      EventBus.offEvent('mission:tick', handleTick);
      EventBus.offEvent('stats:updated', handleStats);
      EventBus.offEvent('progression:updated', handleProgression);
      EventBus.offEvent('city:generated', handleCity);
      EventBus.offEvent('player:health-changed', handleHealth);
      EventBus.offEvent('enemy:threat-changed', handleThreat);
      EventBus.offEvent('game:run-state-changed', handleRunState);
      EventBus.offEvent('game:paused-changed', handlePaused);
      EventBus.offEvent('hud:occlusion-changed', handleOcclusion);
      EventBus.offEvent('game:ready', handleReady);
      EventBus.offEvent('game:destroyed', handleDestroyed);
    };
  }, [setMission, setTimerTick, setStats, setProgression, setCity, setVitals, setThreat, setRunState, setIsPaused, setIsEngineReady, setOccludedPanelIds]);

  // Command dispatch helpers (React -> Phaser)
  const togglePause = useCallback(() => {
    EventBus.sendCommand('cmd:toggle-pause');
  }, []);

  const restartMission = useCallback(() => {
    EventBus.sendCommand('cmd:restart-mission');
  }, []);

  /** Revives the courier and resets the district in place — no city regeneration. */
  const restartRun = useCallback(() => {
    EventBus.sendCommand('cmd:restart-run');
  }, []);

  /** Rolls a brand-new procedural city. Pass a seed to revisit a known district. */
  const regenerateCity = useCallback((seed?: number | string) => {
    EventBus.sendCommand('cmd:regenerate-city', { seed });
  }, []);

  return {
    togglePause,
    restartMission,
    restartRun,
    regenerateCity,
  };
}
