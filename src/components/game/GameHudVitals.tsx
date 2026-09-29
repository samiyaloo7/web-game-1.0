'use client';

import { useGameStore } from '@/stores/useGameStore';
import { OCCLUDED_PANEL_CLASS, usePanelOccluded } from '@/hooks/useHudOcclusion';
import { ShieldAlert, ShieldOff, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Health thresholds drive colour, so damage is legible before the number is read. */
function hullTone(ratio: number): { bar: string; text: string; label: string } {
  if (ratio > 0.6) return { bar: 'bg-emerald-400', text: 'text-emerald-400', label: 'HULL NOMINAL' };
  if (ratio > 0.3) return { bar: 'bg-neon-amber', text: 'text-neon-amber', label: 'HULL STRAINED' };
  return { bar: 'bg-neon-pink', text: 'text-neon-pink', label: 'HULL CRITICAL' };
}

/**
 * GameHudVitals shows courier hull integrity and the current security picture.
 *
 * Subscribes only to `state.vitals` and `state.threat`. Both are written by the event
 * bridge from *change-gated* EventBus events, so this panel re-renders a few times per
 * second at worst — never once per frame. Keeping it separate from `GameHudStats` means a
 * drone starting a chase does not re-render the currency panel.
 */
export function GameHudVitals() {
  const health = useGameStore((s) => s.vitals.health);
  const maxHealth = useGameStore((s) => s.vitals.maxHealth);
  const invulnerable = useGameStore((s) => s.vitals.invulnerable);
  const isDead = useGameStore((s) => s.vitals.isDead);
  const trackingCount = useGameStore((s) => s.threat.trackingCount);
  const nearestDistance = useGameStore((s) => s.threat.nearestDistance);

  // Sits directly beneath the mission panel, so it shares that panel's exposure.
  const isOccluded = usePanelOccluded('hud-vitals');

  const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
  const tone = hullTone(ratio);
  const beingHunted = trackingCount > 0;

  return (
    <div
      data-hud-panel="hud-vitals"
      className={cn(
        'flex items-center gap-3 bg-cyber-dark/85 backdrop-blur-md border border-cyber-border rounded-lg px-3 sm:px-4 py-2 font-mono text-xs shadow-lg transition-opacity duration-300',
        isOccluded && OCCLUDED_PANEL_CLASS
      )}
    >
      {/* Hull integrity */}
      <div className="w-32 sm:w-40">
        <div className="flex items-center justify-between gap-2 leading-none mb-1">
          <span className={`text-[10px] ${tone.text}`}>{isDead ? 'HULL BREACH' : tone.label}</span>
          <span className="text-zinc-400 text-[10px]">
            {Math.ceil(health)}/{maxHealth}
          </span>
        </div>
        <div className="h-2 rounded-sm bg-cyber-black/80 border border-cyber-border overflow-hidden">
          <div
            className={`h-full ${tone.bar} transition-[width] duration-200 ease-out`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>

      {/* Shield window after taking a hit */}
      <div
        className={`flex items-center gap-1 ${
          invulnerable ? 'text-neon-cyan' : 'text-zinc-600'
        }`}
        title="Recovery shield while hull systems reboot"
      >
        {invulnerable ? (
          <ShieldAlert className="w-4 h-4 animate-pulse" />
        ) : (
          <ShieldOff className="w-4 h-4" />
        )}
      </div>

      <div className="w-[1px] h-6 bg-cyber-border" />

      {/* Security droids currently locked onto the courier */}
      <div className={`flex items-center gap-1.5 ${beingHunted ? 'text-neon-pink' : 'text-zinc-400'}`}>
        <Target className={`w-4 h-4 ${beingHunted ? 'animate-pulse' : ''}`} />
        <div>
          <span className="text-zinc-500 text-[10px] block leading-none">LOCKED</span>
          <span className={`font-bold text-sm ${beingHunted ? 'text-neon-pink' : 'text-neon-cyan'}`}>
            {trackingCount}
          </span>
        </div>
      </div>

      {/* Nearest droid, quantised to 10m buckets by the director before it reaches React */}
      <div className="hidden sm:block text-[11px] text-zinc-400">
        <span className="text-zinc-500">NEAREST </span>
        <span className="text-white font-bold">{Math.round(nearestDistance / 10)}m</span>
      </div>
    </div>
  );
}
