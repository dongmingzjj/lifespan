/**
 * Behavior Analysis Type Definitions
 * @module analysis/types
 */

import type { EncryptedEvent } from '../validators/sync.schema.js';

/**
 * Work style classification
 */
export type WorkStyle = 'deep_work' | 'multitask' | 'balanced' | 'unknown';

/**
 * Time of day categories
 */
export type TimeBlock = string; // e.g., "9-11", "14-16"

/**
 * Application usage statistics
 */
export interface AppUsage {
  app_name: string;
  category: string;
  duration_seconds: number;
  percentage: number;
  event_count: number;
}

/**
 * Hourly activity distribution
 */
export interface HourlyActivity {
  hour: number; // 0-23
  total_duration: number;
  event_count: number;
  top_apps: string[];
}

/**
 * Behavior insight from pattern analysis
 */
export interface BehaviorInsight {
  work_style: WorkStyle;
  peak_hours: TimeBlock[];
  total_work_time: number; // seconds
  total_focus_sessions: number;
  avg_focus_duration: number; // seconds
  most_used_apps: AppUsage[];
  category_distribution: Record<string, number>; // percentage
  distractions: string[];
  generated_at: number; // timestamp
  data_range: {
    start: number;
    end: number;
    event_count: number;
  };
}

/**
 * User portrait - comprehensive behavioral profile
 */
export interface UserPortrait {
  user_id: string;
  work_style: WorkStyle;
  peak_productivity_hours: TimeBlock[];
  least_productive_hours: TimeBlock[];
  top_work_apps: Array<{
    app_name: string;
    duration: number;
    category: string;
  }>;
  top_distractions: Array<{
    app_name: string;
    duration: number;
    category: string;
  }>;
  daily_work_hours: number;
  avg_focus_duration: number;
  longest_focus_session: number;
  total_focus_time: number;
  category_breakdown: Record<string, number>;
  productivity_score: number; // 0-100
  generated_at: number;
  data_range: {
    start: number;
    end: number;
  };
}

/**
 * AI-generated recommendation
 */
export interface Recommendation {
  id: string;
  type: 'productivity' | 'health' | 'time_management' | 'focus' | 'habit';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  actionable_steps: string[];
  expected_impact: string;
  created_at: number;
}

/**
 * Comprehensive insight data for API response
 */
export interface InsightData {
  user_id: string;
  insights: BehaviorInsight;
  portrait: UserPortrait | null;
  recommendations: Recommendation[];
  last_updated: number;
}

/**
 * Event data for analysis (decrypted)
 */
export interface EventData {
  id: string;
  event_type: string;
  timestamp: number;
  duration: number;
  app_name?: string;
  category?: string;
  domain?: string;
}

/**
 * Aggregated statistics for AI analysis
 */
export interface AggregatedStats {
  total_events: number;
  total_duration: number;
  avg_duration: number;
  by_hour: Record<number, number>;
  by_category: Record<string, number>;
  by_app: Array<{ app_name: string; duration: number; category: string }>;
  date_range: { start: number; end: number };
}
