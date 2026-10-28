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
      stat_catalog: {
        Row: {
          arg1: string | null;
          arg2: string | null;
          available: boolean | null;
          category: string | null;
          description_es: string | null;
          entity: string | null;
          estimated: boolean | null;
          factor: number | null;
          formula: string | null;
          higher_is_better: boolean | null;
          level: string | null;
          name_es: string | null;
          per90: boolean | null;
          reading_es: string | null;
          rule: string | null;
          short_name: string | null;
          source: string | null;
          stat_group: string | null;
          stat_id: string | null;
          unit: string | null;
        };
        Relationships: [];
      };
      stat_set: {
        Row: {
          description_es: string | null;
          entity: string | null;
          name_es: string | null;
          set_id: string | null;
          sort_order: number | null;
          stat_ids: string[] | null;
        };
        Relationships: [];
      };
      player_master: {
        Row: {
          age: number | null;
          competition_code: string | null;
          full_name: string | null;
          height_cm: number | null;
          known_as: string | null;
          matches: number | null;
          minutes: number | null;
          nationality: string | null;
          player_id: number | null;
          position_group: string | null;
          preferred_foot: string | null;
          shirt_number: number | null;
          stats: Json | null;
          weight_kg: number | null;
        };
        Relationships: [];
      };
      team_match_master: {
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
          penalties_against: number | null;
          penalties_for: number | null;
          referee: string | null;
          round_label: string | null;
          stats: Json | null;
          venue: string | null;
        };
        Relationships: [];
      };
      boca_shot: {
        Row: {
          boca_shot: boolean | null;
          body_part: string | null;
          match_id: number | null;
          minute: number | null;
          outcome: string | null;
          penalty: boolean | null;
          player_name: string | null;
          x: number | null;
          xg: number | null;
          y: number | null;
          zone: string | null;
        };
        Relationships: [];
      };
      boca_formation: {
        Row: {
          boca_formation: string | null;
          match_id: number | null;
          opponent_formation: string | null;
        };
        Relationships: [];
      };
      boca_momentum: {
        Row: {
          boca_value: number | null;
          match_id: number | null;
          minute: number | null;
        };
        Relationships: [];
      };
      league_leader: {
        Row: {
          player_name: string | null;
          rank: number | null;
          season: number | null;
          source: string | null;
          stat: string | null;
          team_name: string | null;
          value: number | null;
        };
        Relationships: [];
      };
      referee_stats: {
        Row: {
          fouls_per_game: number | null;
          games: number | null;
          red_per_game: number | null;
          referee: string | null;
          season: number | null;
          yellow_per_game: number | null;
        };
        Relationships: [];
      };
      league_result: {
        Row: {
          away_goals: number | null;
          away_team: string | null;
          home_goals: number | null;
          home_team: string | null;
          match_date: string | null;
          season: number | null;
          source: string | null;
        };
        Relationships: [];
      };
      league_standing: {
        Row: {
          played: number | null;
          points: number | null;
          rank: number | null;
          season: number | null;
          table_name: string | null;
          team_name: string | null;
        };
        Relationships: [];
      };
      situational_catalog: {
        Row: {
          available: boolean | null;
          card_id: string | null;
          category: string | null;
          condition_es: string | null;
          estimated: boolean | null;
          level: string | null;
          measured_es: string | null;
          params_es: string | null;
          reason_es: string | null;
          required_data: string | null;
          sort_order: number | null;
          title_es: string | null;
        };
        Relationships: [];
      };
      situational_result: {
        Row: {
          base_win_pct: number | null;
          card_id: string | null;
          computed_at: string | null;
          d: number | null;
          delta: number | null;
          goal_diff: number | null;
          l: number | null;
          n: number | null;
          param_order: number | null;
          param_value: string | null;
          ppg: number | null;
          w: number | null;
          win_pct: number | null;
        };
        Relationships: [];
      };
      situational_match: {
        Row: {
          card_id: string | null;
          competition_name: string | null;
          goals_against: number | null;
          goals_for: number | null;
          home: boolean | null;
          match_date: string | null;
          match_id: number | null;
          opponent: string | null;
          param_value: string | null;
          result: string | null;
        };
        Relationships: [];
      };
      stat_match_value: {
        Row: {
          entity: string | null;
          entity_id: number | null;
          high: number | null;
          low: number | null;
          match_id: number | null;
          stat_id: string | null;
          value: number | null;
        };
        Relationships: [];
      };
      projection_param: {
        Row: {
          description_es: string | null;
          param: string | null;
          sport: string | null;
          valid_from: string | null;
          value: number | null;
          version: number | null;
        };
        Relationships: [];
      };
      chart_catalog: {
        Row: {
          available: boolean | null;
          category: string | null;
          chart_id: string | null;
          chart_type: string | null;
          excel: string | null;
          origin_ref: string | null;
          powerbi: string | null;
          reason_es: string | null;
          required_data: string | null;
          sort_order: number | null;
          title_es: string | null;
        };
        Relationships: [];
      };
      chart_source_map: {
        Row: {
          chart_id: string | null;
          label_es: string | null;
          params: string | null;
          target_ref: string | null;
          target_type: string | null;
        };
        Relationships: [];
      };
      player_match_value: {
        Row: {
          key: string | null;
          match_id: number | null;
          player_id: number | null;
          value: number | null;
        };
        Relationships: [];
      };
      club_season_stat: {
        Row: {
          season: number | null;
          source: string | null;
          stat_key: string | null;
          team_name: string | null;
          value: number | null;
        };
        Relationships: [];
      };
      team_window_value: {
        Row: {
          competition_code: string | null;
          coverage: number | null;
          high: number | null;
          low: number | null;
          stat_id: string | null;
          value: number | null;
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
      stat_series: {
        Args: { p_stat: string; p_entity: string; p_id?: number | null };
        Returns: {
          match_id: number;
          match_date: string;
          competition_code: string;
          competition_name: string;
          opponent: string;
          home: boolean;
          result: string;
          goals_for: number;
          goals_against: number;
          minutes: number | null;
          num: number | null;
          den: number | null;
          value: number | null;
        }[];
      };
      stat_windows: {
        Args: { p_stat: string; p_entity: string; p_id?: number | null };
        Returns: {
          window_key: string;
          label: string;
          sort_order: number;
          n: number;
          value: number | null;
          total: number | null;
          best: number | null;
          worst: number | null;
          season: number | null;
          delta: number | null;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
