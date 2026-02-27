/**
 * Analysis API Schemas
 * Request/response validation schemas for behavior analysis endpoints
 * @module validators/analysis-schema
 */

import { z } from 'zod';

// ============================================================================
// Analysis Request Schemas
// ============================================================================

export const GetInsightsSchema = z.object({
  query: z.object({
    force_refresh: z.coerce.boolean().optional().default(false),
    days: z.coerce.number().int().min(1).max(90).optional().default(30),
    max_cache_age: z.coerce.number().int().min(0).optional(),
  }),
});

export const GeneratePortraitSchema = z.object({
  body: z.object({
    days: z.coerce.number().int().min(1).max(90).optional().default(30),
  }),
});

export const GetRecommendationsSchema = z.object({
  query: z.object({
    force_refresh: z.coerce.boolean().optional().default(false),
  }),
});

// ============================================================================
// Response Schemas
// ============================================================================

export const AppUsageSchema = z.object({
  app_name: z.string(),
  category: z.string(),
  duration_seconds: z.number(),
  percentage: z.number(),
  event_count: z.number(),
});

export const BehaviorInsightSchema = z.object({
  work_style: z.enum(['deep_work', 'multitask', 'balanced', 'unknown']),
  peak_hours: z.array(z.string()),
  total_work_time: z.number(),
  total_focus_sessions: z.number(),
  avg_focus_duration: z.number(),
  most_used_apps: z.array(AppUsageSchema),
  category_distribution: z.record(z.string(), z.number()),
  distractions: z.array(z.string()),
  generated_at: z.number(),
  data_range: z.object({
    start: z.number(),
    end: z.number(),
    event_count: z.number(),
  }),
});

export const UserPortraitSchema = z.object({
  user_id: z.string().uuid(),
  work_style: z.enum(['deep_work', 'multitask', 'balanced', 'unknown']),
  peak_productivity_hours: z.array(z.string()),
  least_productive_hours: z.array(z.string()),
  top_work_apps: z.array(z.object({
    app_name: z.string(),
    duration: z.number(),
    category: z.string(),
  })),
  top_distractions: z.array(z.object({
    app_name: z.string(),
    duration: z.number(),
    category: z.string(),
  })),
  daily_work_hours: z.number(),
  avg_focus_duration: z.number(),
  longest_focus_session: z.number(),
  total_focus_time: z.number(),
  category_breakdown: z.record(z.string(), z.number()),
  productivity_score: z.number().min(0).max(100),
  generated_at: z.number(),
  data_range: z.object({
    start: z.number(),
    end: z.number(),
  }),
});

export const RecommendationSchema = z.object({
  id: z.string(),
  type: z.enum(['productivity', 'health', 'time_management', 'focus', 'habit']),
  priority: z.enum(['high', 'medium', 'low']),
  title: z.string(),
  description: z.string(),
  actionable_steps: z.array(z.string()),
  expected_impact: z.string(),
  created_at: z.number(),
});

export const InsightDataSchema = z.object({
  user_id: z.string().uuid(),
  insights: BehaviorInsightSchema,
  portrait: UserPortraitSchema.nullable(),
  recommendations: z.array(RecommendationSchema),
  last_updated: z.number(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type GetInsightsInput = z.infer<typeof GetInsightsSchema>['query'];
export type GeneratePortraitInput = z.infer<typeof GeneratePortraitSchema>['body'];
export type GetRecommendationsInput = z.infer<typeof GetRecommendationsSchema>['query'];
