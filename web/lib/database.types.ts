// Tipos de la base para @supabase/supabase-js.
//
// Se regeneran con `just types`, que corre:
//   supabase gen types typescript --project-id ymnbuywcpkynikudybth --schema api
// Esta primera versión sigue el mismo formato que produce ese comando, escrita a partir de
// las migraciones de supabase/migrations/, porque el generador del MCP de Supabase solo
// cubre el esquema `public` y la web solo consulta el esquema `api`.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  api: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      boca_match: {
        Row: {
          boca_home: boolean | null;
          competition_code: string | null;
          competition_name: string | null;
          goals_against: number | null;
          goals_for: number | null;
          kickoff_at: string | null;
          match_date: string | null;
          match_id: number | null;
          opponent: string | null;
          round_label: string | null;
          season_year: number | null;
          status: string | null;
          venue: string | null;
        };
        Relationships: [];
      };
      player_summary: {
        Row: {
          age: number | null;
          assists: number | null;
          competition_code: string | null;
          competition_name: string | null;
          full_name: string | null;
          goal_contributions: number | null;
          goals: number | null;
          height_cm: number | null;
          known_as: string | null;
          matches: number | null;
          minutes: number | null;
          player_id: number | null;
          position_group: string | null;
          red_cards: number | null;
          shirt_number: number | null;
          starts: number | null;
          yellow_cards: number | null;
        };
        Relationships: [];
      };
      competition_filter: {
        Row: {
          code: string | null;
          matches: number | null;
          name_es: string | null;
          sort_order: number | null;
        };
        Relationships: [];
      };
      system_status: {
        Row: {
          key: string | null;
          updated_at: string | null;
          value: string | null;
        };
        Relationships: [];
      };
      source_status: {
        Row: {
          last_run_at: string | null;
          last_status: string | null;
          last_success_at: string | null;
          source: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
