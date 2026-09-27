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
  const setIsPaused = useGameStore((s) => s.setIsPaused);
  const setIsEngineReady = useGameStore((s) => s.setIsEngineReady);

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

    const handlePaused = (data: GameToUiEvents['game:paused-changed']) => {
      setIsPaused(data.isPaused);
    };

    const handleReady = () => {
      setIsEngineReady(true);
    };

    const handleDestroyed = () => {
      setIsEngineReady(false);
    };

    EventBus.onEvent('mission:updated', handleMission);
    EventBus.onEvent('mission:tick', handleTick);
    EventBus.onEvent('stats:updated', handleStats);
    EventBus.onEvent('game:paused-changed', handlePaused);
    EventBus.onEvent('game:ready', handleReady);
    EventBus.onEvent('game:destroyed', handleDestroyed);

    return () => {
      EventBus.offEvent('mission:updated', handleMission);
      EventBus.offEvent('mission:tick', handleTick);
      EventBus.offEvent('stats:updated', handleStats);
      EventBus.offEvent('game:paused-changed', handlePaused);
      EventBus.offEvent('game:ready', handleReady);
      EventBus.offEvent('game:destroyed', handleDestroyed);
    };
  }, [setMission, setTimerTick, setStats, setIsPaused, setIsEngineReady]);

  // Command dispatch helpers (React -> Phaser)
  const togglePause = useCallback(() => {
    EventBus.sendCommand('cmd:toggle-pause');
  }, []);

  const restartMission = useCallback(() => {
    EventBus.sendCommand('cmd:restart-mission');
  }, []);

  return {
    togglePause,
    restartMission,
  };
}
