'use client';

import { useGameStore } from '@/stores/useGameStore';
import { OCCLUDED_PANEL_CLASS, usePanelOccluded } from '@/hooks/useHudOcclusion';
import { Package, MapPin, Navigation, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * GameHudMission displays active mission objectives, package status, and destination.
 * Subscribes to mission data from the Zustand store.
 */
export function GameHudMission() {
  const status = useGameStore((s) => s.mission.status);
  const packageName = useGameStore((s) => s.mission.packageName);
  const cargoCategory = useGameStore((s) => s.mission.cargoCategory);
  const pickupZone = useGameStore((s) => s.mission.pickupZone);
  const destinationName = useGameStore((s) => s.mission.destinationName);
  const destinationZone = useGameStore((s) => s.mission.destinationZone);
  const remainingTimeSeconds = useGameStore((s) => s.mission.remainingTimeSeconds);
  const timeLimitSeconds = useGameStore((s) => s.mission.timeLimitSeconds);
  const citySeedLabel = useGameStore((s) => s.city.seedLabel);
  const cityCols = useGameStore((s) => s.city.cols);
  const cityRows = useGameStore((s) => s.city.rows);
  const cityLocationCount = useGameStore((s) => s.city.locationCount);

  // The mission panel is the largest block in the top-left, so it is the panel most
  // likely to be hiding the parcel. When it is, it fades to a ghost rather than
  // staying an opaque lid over the district.
  const isOccluded = usePanelOccluded('hud-mission');

  // Status visual configurations
  const statusConfig = {
    unassigned: {
      label: 'STANDBY // SEARCHING FREQUENCY',
      textColor: 'text-zinc-400',
      borderColor: 'border-cyber-border',
      badgeBg: 'bg-zinc-800/60',
    },
    pickup_available: {
      label: 'PRIORITY RETRIEVAL REQUIRED',
      textColor: 'text-neon-amber',
      borderColor: 'border-neon-amber/50',
      badgeBg: 'bg-amber-950/40',
    },
    in_transit: {
      label: 'URGENT DISPATCH EN ROUTE',
      textColor: 'text-neon-cyan',
      borderColor: 'border-neon-cyan/50',
      badgeBg: 'bg-cyan-950/40',
    },
    success: {
      label: 'DELIVERY CONFIRMED',
      textColor: 'text-emerald-400',
      borderColor: 'border-emerald-500/50',
      badgeBg: 'bg-emerald-950/40',
    },
    failed: {
      label: 'CONTRACT VOIDED // EXPIRED',
      textColor: 'text-neon-pink',
      borderColor: 'border-neon-pink/50',
      badgeBg: 'bg-pink-950/40',
    },
  }[status];

  const isUrgent = status === 'in_transit' && remainingTimeSeconds <= 5;

  return (
    <div
      data-hud-panel="hud-mission"
      className={cn(
        'w-full max-w-lg bg-cyber-dark/85 backdrop-blur-md border rounded-lg p-3 sm:p-4 font-mono shadow-xl transition-[opacity,border-color] duration-300',
        statusConfig.borderColor,
        isOccluded && OCCLUDED_PANEL_CLASS
      )}
    >
      {/* Header: Status badge & Timer */}
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-cyber-border/70">
        <div
          className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold tracking-wider',
            statusConfig.badgeBg,
            statusConfig.textColor
          )}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{statusConfig.label}</span>
        </div>

        {/* Quantized Timer readout */}
        <div
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold transition-all',
            status === 'in_transit'
              ? isUrgent
                ? 'bg-neon-pink/20 text-neon-pink animate-pulse border border-neon-pink/50'
                : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : 'text-zinc-500 bg-cyber-surface/50'
          )}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>
            {status === 'in_transit'
              ? `${remainingTimeSeconds}s`
              : status === 'pickup_available'
              ? `${timeLimitSeconds}s (Awaiting)`
              : '--'}
          </span>
        </div>
      </div>

      {/* Package & Destination Info Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {/* Cargo specs */}
        <div className="flex items-start gap-2 bg-cyber-surface/40 p-2 rounded border border-cyber-border/40">
          <Package className="w-4 h-4 text-neon-amber shrink-0 mt-0.5" />
          <div className="overflow-hidden">
            <span className="text-[10px] text-zinc-400 block leading-tight">CARGO PAYLOAD</span>
            <span className="text-white font-semibold truncate block" title={packageName}>
              {packageName}
            </span>
            <span className="text-[10px] text-zinc-500 block">{cargoCategory}</span>
          </div>
        </div>

        {/* Target Destination */}
        <div className="flex items-start gap-2 bg-cyber-surface/40 p-2 rounded border border-cyber-border/40">
          {status === 'pickup_available' ? (
            <MapPin className="w-4 h-4 text-neon-amber shrink-0 mt-0.5" />
          ) : (
            <Navigation className="w-4 h-4 text-neon-pink shrink-0 mt-0.5" />
          )}
          <div className="overflow-hidden">
            <span className="text-[10px] text-zinc-400 block leading-tight">
              {status === 'pickup_available' ? 'RETRIEVAL ZONE' : 'TARGET DESTINATION'}
            </span>
            <span
              className="text-white font-semibold truncate block"
              title={status === 'pickup_available' ? pickupZone : destinationName}
            >
              {status === 'pickup_available' ? pickupZone : destinationName}
            </span>
            <span className="text-[10px] text-zinc-500 block">
              {status === 'pickup_available' ? 'Beacon active' : destinationZone}
            </span>
          </div>
        </div>
      </div>

      {/* Generated district telemetry: seed + grid size */}
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-cyber-border/70 text-[10px] text-zinc-500">
        <span title="Seed of this district. Append ?seed= to the URL to replay it.">
          SECTOR SEED: <span className="text-neon-cyan font-semibold">{citySeedLabel}</span>
        </span>
        <span>
          GRID {cityCols}x{cityRows} &bull; {cityLocationCount} NODES
        </span>
      </div>
    </div>
  );
}
