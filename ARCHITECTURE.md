# Neon Courier - Project Architecture & Technical Design Document

## 1. Overview & Architectural Goals
**Neon Courier** is a top-down futuristic cyber-courier 2D web game built with **Next.js (App Router)**, **Phaser 3**, **Tailwind CSS**, and **Supabase**.

### Design Philosophy for a Solo Developer
1. **Clean Separation of Concerns:** Phaser handles the real-time simulation loop (canvas, physics, inputs, rendering, audio). Next.js and Tailwind handle DOM UI (HUD, inventory modals, upgrade shops, auth, leaderboards).
2. **Unidirectional State Flow:** Game simulation emits typed events outwards; React consumes them to update UI. React dispatches player decisions into the game via a clean API bridge.
3. **Optimistic Gameplay, Authoritative Persistence:** High-frequency arcade physics stays client-side for zero latency. Critical persistent state (upgrades, balance, high scores) is validated server-side with Zod + Supabase Database Webhooks / RLS / RPC.
4. **No Premature Over-Engineering:** Avoid microservices, complex custom ECS (Entity Component System) frameworks, or heavy state machines like XState until complexity warrants them. Rely on native TypeScript events, standard React state/Zustand, and Phaser scenes.

---

## 2. Recommended Folder Structure

```text
neon-courier/
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Runs lint, typecheck, Vitest, Playwright
│       └── deploy.yml             # Preview/Production deployment checks
├── public/
│   ├── assets/
│   │   ├── audio/                 # SFX and synthwave background music
│   │   ├── images/                # Spritesheets, tilesets, UI icons
│   │   └── maps/                  # Tiled JSON maps
│   └── favicon.ico
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── (game)/
│   │   │   ├── play/page.tsx      # Main game canvas + overlay layout
│   │   │   └── upgrades/page.tsx  # Garage / Upgrade workshop screen
│   │   ├── api/                   # Serverless route handlers (if needed)
│   │   │   ├── delivery/complete/route.ts
│   │   │   └── leaderboard/route.ts
│   │   ├── layout.tsx
│   │   ├── page.tsx               # Landing page / Main Menu
│   │   └── globals.css
│   ├── components/                # React UI Components
│   │   ├── auth/                  # LoginForm, AuthGuard
│   │   ├── game/                  # React overlays on top of Phaser Canvas
│   │   │   ├── GameCanvas.tsx     # Phaser lifecycle container component
│   │   │   ├── GameHUD.tsx        # Health, Speedometer, Package Timer, Minimap UI
│   │   │   ├── DeliveryModal.tsx  # Mission accepted / delivered dialog
│   │   │   └── GameOverDialog.tsx
│   │   ├── upgrades/              # Shop cards, stat comparison bars
│   │   └── ui/                    # Base design system (Buttons, Cards, Dialogs)
│   ├── game/                      # Pure Phaser 3 Game Engine Code (No React imports)
│   │   ├── config.ts              # Phaser.Types.Core.GameConfig
│   │   ├── EventBus.ts            # Typed Event emitter bridging Phaser <-> React
│   │   ├── scenes/
│   │   │   ├── BootScene.ts       # Config initialization & basic assets
│   │   │   ├── PreloadScene.ts    # Asset loading with progress feedback
│   │   │   ├── CityScene.ts       # Main open delivery world
│   │   │   └── PauseScene.ts
│   │   ├── entities/
│   │   │   ├── Player.ts          # Hoverbike/Cyber-courier sprite + Arcade Physics
│   │   │   ├── EnemyDrone.ts      # Patrol / chase AI drones
│   │   │   ├── Obstacle.ts        # Traffic, laser gates, speed pads
│   │   │   └── PackageDrop.ts     # Pickup and destination trigger zones
│   │   ├── systems/
│   │   │   ├── InputManager.ts    # Keyboard, touch/gamepad mappings
│   │   │   ├── DeliveryManager.ts # Delivery mission lifecycle inside simulation
│   │   │   └── AudioManager.ts    # WebAudio / Phaser sound wrapper
│   │   └── types/
│   │       └── game-events.ts     # Event payload definitions
│   ├── hooks/                     # Custom React Hooks
│   │   ├── useGameBridge.ts       # Hook subscribing React components to Phaser EventBus
│   │   ├── usePlayerStats.ts      # Queries/mutations for credits & upgrades
│   │   └── useSupabaseSession.ts  # Auth status & session management
│   ├── lib/                       # External SDKs and Shared Config
│   │   ├── supabase/
│   │   │   ├── client.ts          # Browser client (createBrowserClient)
│   │   │   ├── server.ts          # Server client (createServerClient)
│   │   │   └── middleware.ts      # Session refresh & protected routes
│   │   └── env.ts                 # Validated environment variables (via Zod)
│   ├── stores/                    # Client UI State (e.g., Zustand)
│   │   ├── useGameStore.ts        # Reactive game HUD state (speed, health, active mission)
│   │   └── useUpgradeStore.ts     # Selected upgrades, garage state
│   ├── schemas/                   # Zod Schemas for runtime contract validation
│   │   ├── profile.schema.ts      # Player profile, XP, Credits
│   │   ├── upgrade.schema.ts      # Upgrade tiers, cost, multiplier attributes
│   │   └── score.schema.ts        # Delivery logs & leaderboard records
│   └── types/                     # Global TypeScript declarations
│       ├── database.types.ts      # Auto-generated from Supabase CLI
│       └── models.ts              # Domain model interfaces
├── tests/
│   ├── unit/                      # Vitest: pure functions, Zod schemas, game maths
│   │   ├── delivery-math.test.ts
│   │   └── schemas.test.ts
│   └── e2e/                       # Playwright: user flows
│       ├── auth.spec.ts
│       └── game-load.spec.ts
├── supabase/
│   ├── migrations/                # Version-controlled SQL migrations
│   │   └── 20260101000000_init.sql
│   └── seed.sql                   # Sample upgrades, test accounts
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
└── playwright.config.ts
```

### Folder Responsibilities Explained
- **`src/game/` vs `src/components/game/`:** 
  - `src/game/` has **zero React dependencies**. It is plain TypeScript classes and Phaser objects. This avoids memory leaks and React render thrashing.
  - `src/components/game/` contains the React boundary (`GameCanvas.tsx`) which instantiates the game, mounts the canvas, and tears it down cleanly on unmount.
- **`src/schemas/`:** Single source of truth for runtime validation using Zod. Used both on client forms and on Next.js API route handlers to validate data before it touches Supabase.
- **`src/lib/supabase/`:** Follows `@supabase/ssr` official guidelines with distinct clients for Browser, Server Components/Actions, and Middleware.
- **`supabase/migrations/`:** Database schema stored in git, applied via Supabase CLI, guaranteeing reproducibility across local development and production.

---

## 3. Separation Between Next.js UI and Phaser Game Code

### The Dilemma
Phaser runs at 60 FPS on an internal requestAnimationFrame ticker. React updates asynchronously based on state changes. If React re-renders on every game frame or if Phaser tries to render rich DOM dialogues, performance degrades and architecture turns into spaghetti.

### The Solution: EventBus Bridge Pattern
Create a decoupled, typed communication bridge using `mitt` or Phaser's built-in `Phaser.Events.EventEmitter`.

```typescript
// src/game/EventBus.ts
import Phaser from 'phaser';

export type GameEventMap = {
  'player:stats-changed': { health: number; maxHealth: number; speed: number };
  'package:picked-up': { id: string; destinationName: string; timeLimitSeconds: number };
  'package:delivered': { id: string; rewardCredits: number; rewardXp: number; bonus: number };
  'delivery:failed': { reason: 'destroyed' | 'timeout' };
  'game:ready': void;
  'game:destroy': void;
};

export class GameEventBus extends Phaser.Events.EventEmitter {
  emit<K extends keyof GameEventMap>(event: K, data?: GameEventMap[K]): boolean {
    return super.emit(event, data);
  }

  on<K extends keyof GameEventMap>(event: K, fn: (data: GameEventMap[K]) => void, context?: any): this {
    return super.on(event, fn, context);
  }

  off<K extends keyof GameEventMap>(event: K, fn?: (data: GameEventMap[K]) => void, context?: any): this {
    return super.off(event, fn, context);
  }
}

export const EventBus = new GameEventBus();
```

### React Mounting Pattern (`GameCanvas.tsx`)
```tsx
// src/components/game/GameCanvas.tsx
'use client';

import { useEffect, useRef } from 'react';
import { EventBus } from '@/game/EventBus';

export function GameCanvas() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;

    async function initPhaser() {
      if (!containerRef.current || gameRef.current) return;

      const { createGameConfig } = await import('@/game/config');
      const Phaser = (await import('phaser')).default;

      if (!isMounted) return;

      const config = createGameConfig(containerRef.current);
      gameRef.current = new Phaser.Game(config);
      EventBus.emit('game:ready');
    }

    initPhaser();

    return () => {
      isMounted = false;
      EventBus.emit('game:destroy');
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return <div id="phaser-container" ref={containerRef} className="w-full h-full relative" />;
}
```

### Hook Bridge for React HUD (`useGameBridge.ts`)
```typescript
// src/hooks/useGameBridge.ts
'use client';

import { useEffect } from 'react';
import { EventBus, GameEventMap } from '@/game/EventBus';
import { useGameStore } from '@/stores/useGameStore';

export function useGameBridge() {
  const setPlayerStats = useGameStore((s) => s.setPlayerStats);
  const setActiveMission = useGameStore((s) => s.setActiveMission);
  const completeMission = useGameStore((s) => s.completeMission);

  useEffect(() => {
    const handleStats = (data: GameEventMap['player:stats-changed']) => setPlayerStats(data);
    const handlePickup = (data: GameEventMap['package:picked-up']) => setActiveMission(data);
    const handleDelivery = (data: GameEventMap['package:delivered']) => completeMission(data);

    EventBus.on('player:stats-changed', handleStats);
    EventBus.on('package:picked-up', handlePickup);
    EventBus.on('package:delivered', handleDelivery);

    return () => {
      EventBus.off('player:stats-changed', handleStats);
      EventBus.off('package:picked-up', handlePickup);
      EventBus.off('package:delivered', handleDelivery);
    };
  }, [setPlayerStats, setActiveMission, completeMission]);
}
```

### Why this works:
- **No Phaser in Next.js Server Components:** Game is loaded purely via dynamic client hooks.
- **Zero React overhead during 60 FPS driving:** Phaser only emits events when meaningful thresholds change (e.g., speed rounded to whole number, health change, quest milestone), rather than every sub-tick.
- **React renders beautiful Tailwind UI:** Modals, tooltips, buttons, and HUD gauges use Tailwind without messing with Phaser's Canvas Text or complex bitmap fonts.

---

## 4. Game State Architecture

The game has three distinct layers of state:

| Layer | Responsibility | Technology | Persistence |
|---|---|---|---|
| **Ephemeral Simulation State** | Position, velocity, acceleration, active collision frames, particle timers | Phaser Scene & Sprite class properties | In-Memory (lost on game over/refresh) |
| **Session / HUD State** | Active delivery timer, current payload, score in current run, UI modal flags | Zustand (`useGameStore`) | In-Memory (synced via EventBus) |
| **Persistent Progression State** | Total Credits, XP, unlocked bikes, engine/shield upgrades, leaderboard high scores | Supabase Database | PostgreSQL (cloud persisted) |

### Synchronization Flow
1. **Game Start:** React queries Supabase for player's current upgrades (e.g. Engine Level 2 = +20% max speed).
2. **Init Simulation:** React/Page passes upgrade stats as `data` into Phaser scene startup: `scene.start('CityScene', { stats })`.
3. **During Run:** Phaser runs pure physics. Pickup/drop triggers update local score and emit events to Zustand.
4. **Run Completion (Delivery or Crash):**
   - React detects run termination.
   - React calls Next.js Server Action or API Route with completion payload (tokens, delivery proof).
   - Server validates payload via Zod, checks session, updates Supabase records, and increments credits/XP.
   - Updated profile returns to React store and unlocks upgrade shop items.

---

## 5. Supabase Integration Architecture

### Database Schema (PostgreSQL)

```sql
-- 1. Profiles (linked to auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  credits integer not null default 100 check (credits >= 0),
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Upgrades Catalog
create table public.upgrades (
  id text primary key, -- e.g. 'engine_mk1', 'engine_mk2', 'shield_mk1'
  category text not null, -- 'engine' | 'shield' | 'cargo'
  tier integer not null default 1,
  name text not null,
  description text not null,
  cost_credits integer not null check (cost_credits >= 0),
  stat_modifiers jsonb not null default '{}'::jsonb
);

-- 3. Player Owned Upgrades (Join table)
create table public.player_upgrades (
  player_id uuid references public.profiles(id) on delete cascade,
  upgrade_id text references public.upgrades(id) on delete cascade,
  equipped boolean not null default false,
  unlocked_at timestamptz not null default now(),
  primary key (player_id, upgrade_id)
);

-- 4. Deliveries / Runs (Leaderboard & Audit)
create table public.delivery_records (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.profiles(id) on delete cascade,
  distance_travelled numeric not null,
  time_seconds numeric not null,
  credits_earned integer not null check (credits_earned >= 0),
  status text not null check (status in ('completed', 'failed', 'abandoned')),
  created_at timestamptz not null default now()
);
```

### Row Level Security (RLS) Strategy
- `profiles`:
  - `SELECT`: Public (for leaderboards and profile display).
  - `UPDATE`: Only `auth.uid() = id`, but restricted so players cannot directly modify `credits` or `xp` from the client!
  - *Best Practice:* Use a Database Function (RPC) or Server Route with Service Role to increment credits securely after delivery validation.
- `upgrades`:
  - `SELECT`: `true` (all authenticated and anonymous users can read available upgrades).
  - `INSERT/UPDATE/DELETE`: Denied (admin only via seed migrations).
- `player_upgrades`:
  - `SELECT`: `auth.uid() = player_id`.
  - `INSERT/UPDATE`: Executed via an atomic RPC function (`purchase_upgrade(upgrade_id)`):
    - Checks balance >= cost.
    - Deducts cost from `profiles.credits`.
    - Inserts record into `player_upgrades`.
    - Guarantees transaction atomicity (no double-spending).

---

## 6. TypeScript Conventions

1. **Strict Type Safety:**
   - Enable `"strict": true`, `"noImplicitAny": true`, `"exactOptionalPropertyTypes": true`.
2. **Path Aliasing:**
   - Use `@/` for root `src/` directory (e.g., `@/game/...`, `@/components/...`).
3. **Supabase Auto-Generated Types:**
   - Run `supabase gen types typescript --project-id <id> > src/types/database.types.ts`.
   - Never manually hand-write raw database table types.
4. **Zod Inference (`z.infer`):**
   - Use `z.infer<typeof MySchema>` for all DTOs and API requests/responses.
5. **No `any` in Game Code:**
   - Use `unknown` or explicit generic constraints for Phaser physics bodies:
   ```typescript
   const body = this.body as Phaser.Physics.Arcade.Body;
   ```
6. **Discriminated Unions for Game Actions & States:**
   ```typescript
   export type DeliveryStatus = 
     | { state: 'idle' }
     | { state: 'in-transit'; packageId: string; expiresAt: number }
     | { state: 'delivered'; reward: number }
     | { state: 'crashed'; reason: string };
   ```

---

## 7. Environment Variable Strategy

### Configuration & Validation
Never access `process.env.VAR` directly across components. Use a centralized validator (`src/lib/env.ts`) using Zod.

```typescript
// src/lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(), // Only available server-side
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NODE_ENV: process.env.NODE_ENV,
});
```

### Safety Rules:
- **`NEXT_PUBLIC_*`:** Only exposed when necessary in the browser (Supabase URL & Anon Key).
- **Secret Keys:** `SUPABASE_SERVICE_ROLE_KEY` must never be prefixed with `NEXT_PUBLIC_`. If leaked, players can wipe the database.
- **`.env.example`:** Maintain an updated template without secret credentials for version control.

---

## 8. Error-Handling Strategy

1. **Phaser Simulation Fallbacks:**
   - Wrap asset loading in `PreloadScene` with fallback textures (`this.textures.generate('fallback-box', ...)`) so game boots even if a PNG fails to load.
   - Use a top-level error event boundary in Phaser to log crashes without unmounting the React DOM completely.
2. **React Error Boundaries:**
   - Wrap `<GameCanvas />` inside a React Error Boundary with a graceful "System Reboot" button.
3. **API & Server Actions Validation:**
   - Use standard `Result` objects or HTTP status codes:
   ```typescript
   export type ActionResult<T> = 
     | { success: true; data: T }
     | { success: false; error: string; code?: string };
   ```
4. **Supabase Client Errors:**
   - Handle network disconnections during gameplay gracefully: store completed delivery records in `localStorage` queue if offline, then retry syncing when online.

---

## 9. Testing Strategy

### 1. Vitest (Unit & Domain Logic)
- **What to test:**
  - Delivery reward and scoring algorithms (distance * time multiplier * cargo fragility).
  - Upgrade math (engine speed calculation with diminishing returns).
  - Zod schema validation (testing edge cases on API inputs).
  - Zustand store reducer actions.
- **Why:** Instant execution (<100ms), no browser or canvas overhead.

### 2. Playwright (End-to-End & Smoke Tests)
- **What to test:**
  - Auth flow (Login -> Session established -> Redirect to `/play`).
  - Canvas initialization test (Verify `<canvas>` element mounts and WebGL/Canvas context is acquired).
  - Garage upgrade purchase interaction (User clicks "Upgrade Shield", credits decrease, item shows "Equipped").
- **Why:** Guarantees critical user flows work on deployment without tedious manual testing.

---

## 10. Git Branch & Commit Strategy

### Branching Model (GitHub Flow - Solo Developer Friendly)
Keep it lightweight. Avoid full GitFlow with release branches:
- **`main`:** Always deployable, automatically triggers preview/production builds on Vercel.
- **`feat/<feature-name>`:** Active development (e.g., `feat/player-movement`, `feat/upgrade-shop`).
- **`fix/<bug-name>`:** Bug fixes (e.g., `fix/collision-glitch`).

### Commit Convention (Conventional Commits)
Format: `<type>(<scope>): <subject>`
- `feat(game): add hoverbike drift physics`
- `feat(ui): implement HUD speedometer and timer`
- `fix(supabase): resolve atomic credit deduction in purchase_upgrade RPC`
- `test(unit): add delivery reward calculation tests`
- `refactor(events): migrate EventBus to typed Phaser EventEmitter`

---

## 11. Performance Considerations

1. **Phaser Asset Management:**
   - Use Texture Atlases (via TexturePacker or free online spritesheet packers) rather than 50 individual PNG files. This reduces HTTP requests and drastically improves WebGL draw call batching.
2. **Audio Performance:**
   - Load SFX as compressed `.ogg` or `.mp3` with audio sprites.
   - Avoid creating new Audio objects on every collision; use Phaser sound pool.
3. **React Render Shielding:**
   - Never bind high-frequency variables (like player coordinates `(x, y)` updating 60 times/sec) to React state.
   - Only bind low-frequency game events (package picked up, health dropped by 10%, game over) to React.
4. **Next.js Dynamic Imports:**
   - Load Phaser strictly dynamically with `ssr: false`:
   ```typescript
   const GameCanvas = dynamic(() => import('@/components/game/GameCanvas'), { ssr: false });
   ```
   This prevents Next.js server runtime from trying to access `window` or `navigator` and keeps initial page bundle size small.

---

## 12. Security Considerations

1. **Client-Side Anti-Cheat Mindset for Solo Web Games:**
   - Remember: In any client-side JavaScript game, the player can inspect memory and change their speed or health.
   - **Do not fight unwinnable battles:** For a single-player learning game, spending weeks building server-side authoritative physics simulation is unnecessary over-engineering.
   - **Protect Persistent State:**
     - Client *requests* a delivery completion by sending `{ missionId, startTimestamp, finishTimestamp }`.
     - Server checks: Is `finishTimestamp - startTimestamp` physically possible? (e.g., minimum theoretical transit time is 15 seconds; if delivered in 0.5 seconds, reject).
     - RLS prevents direct updates to `profiles.credits`. Only server actions or RPC can grant credits.

---

## 13. Practical Implementation Order (Phases)

Follow this step-by-step roadmap to make progress without getting overwhelmed:

### Phase 1: Project Setup & Tooling Foundation
- [ ] Initialize Next.js project with TypeScript, Tailwind CSS, ESLint.
- [ ] Configure Vitest and Playwright.
- [ ] Setup Git repository, `.gitignore`, and GitHub Actions CI for lint/tests.
- [ ] Setup `src/lib/env.ts` with Zod.

### Phase 2: Phaser Canvas Integration & Basic Movement
- [ ] Setup dynamic Phaser game initialization in Next.js (`GameCanvas.tsx`).
- [ ] Create `BootScene` and `PreloadScene`.
- [ ] Implement `CityScene` with a simple tilemap or placeholder grid.
- [ ] Implement `Player.ts` hoverbike with basic top-down Arcade Physics (acceleration, steering, drag).
- [ ] Build `EventBus.ts` and test emitting speed/health out to a simple React HUD.

### Phase 3: Core Gameplay Loop (Pickups & Obstacles)
- [ ] Implement `PackageDrop.ts` (pickup zone and destination marker).
- [ ] Implement `EnemyDrone.ts` or static hazards (laser fences, traffic cars).
- [ ] Implement Delivery Mission Manager (Timer countdown, delivery success/failure states).
- [ ] Connect React `GameHUD.tsx` with mission status, timer, and score.

### Phase 4: Supabase Backend & Authentication
- [ ] Initialize local Supabase CLI and database schema migrations (`profiles`, `upgrades`, `player_upgrades`).
- [ ] Implement Next.js Supabase auth helpers (Email/Password or Anonymous Sign-in).
- [ ] Create RPC functions for awarding delivery rewards and purchasing upgrades.

### Phase 5: Progression & Garage (Upgrade Shop)
- [ ] Build the Upgrade Shop UI in Next.js (`/upgrades`) with Tailwind cards.
- [ ] Connect shop to Supabase `player_upgrades`.
- [ ] Pass equipped upgrade stats into Phaser on game start (e.g. higher top speed, extra armor).

### Phase 6: Polish, Testing & Deployment
- [ ] Add retro synthwave cyber styling with Tailwind (neon borders, glow filters, fonts).
- [ ] Add sound effects and ambient cyber audio.
- [ ] Write unit tests for reward calculation logic and Zod validation.
- [ ] Write Playwright smoke test for game loading.
- [ ] Deploy to Vercel and link Supabase production project.
