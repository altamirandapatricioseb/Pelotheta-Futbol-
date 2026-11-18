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
      model_run: {
        Row: {
          model: string | null;
          team_slug: string | null;
          status: string | null;
          n: number | null;
          metrics: Json | null;
          params: Json | null;
          message: string | null;
          trained_at: string | null;
        };
        Relationships: [];
      };
      market_value_prediction: {
        Row: {
          team_slug: string | null;
          player_id: number | null;
          player_name: string | null;
          position_group: string | null;
          actual_eur: number | null;
          predicted_eur: number | null;
          low_eur: number | null;
          high_eur: number | null;
          residual_pct: number | null;
          features: Json | null;
        };
        Relationships: [];
      };
      market_value_coef: {
        Row: {
          team_slug: string | null;
          feature: string | null;
          coef: number | null;
          std_err: number | null;
          t_stat: number | null;
          p_value: number | null;
          ci_low: number | null;
          ci_high: number | null;
        };
        Relationships: [];
      };
      player_market_value: {
        Row: {
          player_id: number | null;
          player_name: string | null;
          team_slug: string | null;
          as_of: string | null;
          value_eur: number | null;
          source: string | null;
          source_url: string | null;
        };
        Relationships: [];
      };
      player_style: {
        Row: {
          team_slug: string | null;
          player_id: number | null;
          player_name: string | null;
          position_group: string | null;
          cluster: number | null;
          cluster_label: string | null;
          pc1: number | null;
          pc2: number | null;
          features: Json | null;
          z: Json | null;
          percentiles: Json | null;
        };
        Relationships: [];
      };
      player_pool: {
        Row: {
          source: string | null;
          ext_id: string | null;
          player_name: string | null;
          team_name: string | null;
          club_ext_id: string | null;
          competition: string | null;
          position_group: string | null;
          age: number | null;
          minutes: number | null;
          stats: Json | null;
          value_eur: number | null;
          value_as_of: string | null;
          source_url: string | null;
        };
        Relationships: [];
      };
      player_alternative: {
        Row: {
          team_slug: string | null;
          player_id: number | null;
          section: string | null;
          rank: number | null;
          members: Json | null;
          similarity: number | null;
          total_value_eur: number | null;
          savings_eur: number | null;
        };
        Relationships: [];
      };
      match_prediction: {
        Row: {
          team_slug: string | null;
          kind: string | null;
          match_date: string | null;
          home_team: string | null;
          away_team: string | null;
          lambda_home: number | null;
          lambda_away: number | null;
          p_home: number | null;
          p_draw: number | null;
          p_away: number | null;
          top_scores: Json | null;
          score_matrix: Json | null;
          sim: Json | null;
          actual_home: number | null;
          actual_away: number | null;
        };
        Relationships: [];
      };
      team_strength: {
        Row: {
          team_slug: string | null;
          team_name: string | null;
          home_games: number | null;
          away_games: number | null;
          attack_home: number | null;
          defense_home: number | null;
          attack_away: number | null;
          defense_away: number | null;
          goals_for: number | null;
          goals_against: number | null;
        };
        Relationships: [];
      };
      stat_test: {
        Row: {
          team_slug: string | null;
          test_id: string | null;
          title_es: string | null;
          statistic: number | null;
          df: number | null;
          p_value: number | null;
          decision_es: string | null;
          detail: Json | null;
        };
        Relationships: [];
      };
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
          key_stat: boolean | null;
          lines: string[] | null;
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
      match_lineup: {
        Row: {
          match_id: number | null;
          minute_in: number | null;
          minute_out: number | null;
          player_id: number | null;
          player_name: string | null;
          position: string | null;
          shirt_number: number | null;
          started: boolean | null;
        };
        Relationships: [];
      };
      boca_absence: {
        Row: {
          boca_absence: boolean | null;
          match_id: number | null;
          player_id: number | null;
          player_name: string | null;
          reason: string | null;
        };
        Relationships: [];
      };
      data_quality: {
        Row: {
          check_id: string;
          table_name: string;
          check_type: string;
          description_es: string;
          failing: number;
          total: number;
          checked_at: string;
        };
        Relationships: [];
      };
      match_context: {
        Row: {
          match_id: number;
          boca_coach: string | null;
          rival_coach: string | null;
          stadium: string | null;
          stadium_capacity: number | null;
          source: string;
        };
        Relationships: [];
      };
      boca_weather: {
        Row: {
          match_id: number | null;
          place: string | null;
          precipitation_mm: number | null;
          temperature_c: number | null;
          wind_kmh: number | null;
        };
        Relationships: [];
      };
      player_position: {
        Row: {
          detail_level: string | null;
          games: number | null;
          lane: string | null;
          player_id: number | null;
          position_raw: string | null;
          role: string | null;
          starts: number | null;
          zone: string | null;
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
          main_metric: string | null;
          extra_metrics: string | null;
        };
        Relationships: [];
      };
      situational_result: {
        Row: {
          base_win_pct: number | null;
          base_ppg: number | null;
          base_gf: number | null;
          base_ga: number | null;
          base_clean: number | null;
          gf_avg: number | null;
          ga_avg: number | null;
          clean_pct: number | null;
          scored_pct: number | null;
          stats: Json | null;
          base_stats: Json | null;
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
      conclusion: {
        Row: {
          entity_id: number | null;
          player_name: string | null;
          player_position: string | null;
          area: string | null;
          band: string | null;
          computed_at: string | null;
          kind: string | null;
          link: string | null;
          n: number | null;
          percentile: number | null;
          reference: number | null;
          rule_id: string | null;
          scope: string | null;
          sort_order: number | null;
          text_es: string | null;
          title_es: string | null;
          tone: string | null;
          unit: string | null;
          value: number | null;
        };
        Relationships: [];
      };
      stat_value_detail: {
        Row: {
          detail: Json | null;
          player_id: number | null;
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
      pipeline_run_metrics: {
        Row: {
          run_id: string;
          started_at: string;
          finished_at: string;
          duration_s: number;
          status: string;
          matches: number;
          rows_loaded: number;
          warnings: number;
          errors: number;
          db_size_bytes: number | null;
          commit_sha: string | null;
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
