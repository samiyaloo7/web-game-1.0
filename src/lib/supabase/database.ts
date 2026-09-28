/**
 * Hand-written mirror of `supabase/migrations/*.sql`, giving supabase-js full
 * end-to-end type safety (tables, the leaderboard view, the two RPCs).
 *
 * Once the project exists, regenerate the canonical version and replace this
 * file:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.ts
 * Two deliberate refinements over raw generated output:
 *   * `status` is a literal union (the CHECK constraint), not plain `string`;
 *   * `upgrades` is `Record<string, number>` (the RPC's validated shape), not `Json`.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ScoreStatus = 'completed' | 'failed';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          created_at?: string;
          updated_at?: string;
        };
        /** Column-level GRANT only ever exposes `username` to clients. */
        Update: {
          username?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      player_progress: {
        Row: {
          profile_id: string;
          money: number;
          xp: number;
          /** Generated column — present in reads, never accepted on writes. */
          level: number;
          upgrades: Record<string, number>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          money?: number;
          xp?: number;
          upgrades?: Record<string, number>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          money?: number;
          xp?: number;
          upgrades?: Record<string, number>;
        };
        Relationships: [
          {
            foreignKeyName: 'player_progress_profile_id_fkey';
            columns: ['profile_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      scores: {
        Row: {
          id: number;
          profile_id: string;
          status: ScoreStatus;
          credits: number;
          xp: number;
          /** GENERATED as `credits + xp * 2` — never accepted on writes. */
          score: number;
          time_seconds: number;
          /** FK into the server-owned reward catalog. */
          package_id: string | null;
          /** What the client *asked* for. Audit only; never ranked. */
          claimed_credits: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          profile_id: string;
          status?: ScoreStatus;
          credits?: number;
          xp?: number;
          time_seconds?: number;
          package_id?: string | null;
          claimed_credits?: number | null;
          created_at?: string;
        };
        /**
         * No client write path exists (RLS has no write policy and no client
         * INSERT grant); writes go through `submit_delivery`/`record_failure`.
         */
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: 'scores_profile_id_fkey';
            columns: ['profile_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      leaderboard: {
        Row: {
          rank: number;
          profile_id: string;
          username: string;
          deliveries: number;
          total_score: number;
          total_credits: number;
          best_score: number;
          last_delivery_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      save_player_progress: {
        Args: {
          p_money: number;
          p_xp: number;
          p_upgrades: Record<string, number>;
        };
        Returns: Database['public']['Tables']['player_progress']['Row'];
      };
      username_available: {
        Args: { p_username: string };
        Returns: boolean;
      };
      /**
       * Server-authoritative delivery write. Note the Args contain no `credits`
       * and no `xp` — the function derives both, which is the whole point.
       */
      submit_delivery: {
        Args: {
          p_package_id: string;
          p_time_ratio: number;
          p_duration_seconds: number;
          p_claimed_credits?: number;
        };
        Returns: {
          score_id: number;
          credits: number;
          xp: number;
          score: number;
          is_new_best: boolean;
        }[];
      };
      record_failure: {
        Args: { p_package_id?: string; p_duration_seconds?: number };
        Returns: number;
      };
      /** Offset-paginated board carrying true global ranks. */
      leaderboard_page: {
        Args: { p_offset?: number; p_limit?: number };
        Returns: Database['public']['Views']['leaderboard']['Row'][];
      };
      /** Self-scoped count of recent submissions — the rate-limit primitive. */
      recent_delivery_count: {
        Args: { p_within_seconds?: number; p_limit?: number };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
