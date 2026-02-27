/**
 * Behavior Analyzer
 * Analyzes user event data to extract behavior patterns and insights
 * @module services/behavior-analyzer
 */

import { query } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, DatabaseError } from '../utils/errors.js';
import type {
  EventData,
  AggregatedStats,
  BehaviorInsight,
  UserPortrait,
} from '../types/analysis.types';

/**
 * Behavior Analyzer
 * Provides pattern recognition and statistical analysis of user events
 */
export class BehaviorAnalyzer {
  /**
   * Analyze user behavior patterns from events
   */
  async analyzePatterns(userId: string, days: number = 30): Promise<BehaviorInsight> {
    const startTime = Date.now();

    try {
      logger.info({ userId, days }, 'Starting behavior pattern analysis');

      // Fetch events for the specified time range
      const events = await this.fetchEvents(userId, days);

      if (events.length === 0) {
        logger.warn({ userId, days }, 'No events found for analysis');
        throw new NotFoundError('No events found for the specified time range');
      }

      // Aggregate statistics
      const stats = this.aggregateStats(events);

      logger.info({
        userId,
        eventCount: events.length,
        duration: Date.now() - startTime,
      }, 'Behavior pattern analysis completed');

      // Import here to avoid circular dependency
      const { aiClient } = await import('./ai-client.js');
      return aiClient.analyzeBehavior(stats);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        err: error,
        userId,
        days,
      }, 'Behavior pattern analysis failed');

      throw new DatabaseError('Failed to analyze behavior patterns', error as Error);
    }
  }

  /**
   * Generate user portrait from event data
   */
  async generatePortrait(userId: string, days: number = 30): Promise<UserPortrait> {
    const startTime = Date.now();

    try {
      logger.info({ userId, days }, 'Starting user portrait generation');

      // Fetch events for the specified time range
      const events = await this.fetchEvents(userId, days);

      if (events.length === 0) {
        logger.warn({ userId, days }, 'No events found for portrait generation');
        throw new NotFoundError('No events found for the specified time range');
      }

      // Aggregate statistics
      const stats = this.aggregateStats(events);

      // Import AI client
      const { aiClient } = await import('./ai-client.js');
      const portrait = await aiClient.generatePortrait(stats);

      // Set user_id
      portrait.user_id = userId;

      logger.info({
        userId,
        eventCount: events.length,
        workStyle: portrait.work_style,
        productivityScore: portrait.productivity_score,
        duration: Date.now() - startTime,
      }, 'User portrait generation completed');

      return portrait;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        err: error,
        userId,
        days,
      }, 'User portrait generation failed');

      throw new DatabaseError('Failed to generate user portrait', error as Error);
    }
  }

  /**
   * Fetch events for a user within a time range
   */
  private async fetchEvents(userId: string, days: number): Promise<EventData[]> {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

    const result = await query(
      `SELECT
        id,
        event_type,
        timestamp,
        duration,
        app_name,
        category,
        domain
      FROM events
      WHERE user_id = $1
        AND timestamp >= $2
      ORDER BY timestamp ASC`,
      [userId, new Date(startTime)]
    );

    return result.rows.map(row => ({
      id: row.id,
      event_type: row.event_type,
      timestamp: new Date(row.timestamp).getTime(),
      duration: row.duration,
      app_name: row.app_name || undefined,
      category: row.category || undefined,
      domain: row.domain || undefined,
    }));
  }

  /**
   * Aggregate events into statistics
   */
  private aggregateStats(events: EventData[]): AggregatedStats {
    const byHour: Record<number, number> = {};
    const byCategory: Record<string, number> = {};
    const byAppMap = new Map<string, { duration: number; category: string }>();

    let totalDuration = 0;
    let minTimestamp = Infinity;
    let maxTimestamp = 0;

    // Initialize hours
    for (let i = 0; i < 24; i++) {
      byHour[i] = 0;
    }

    for (const event of events) {
      totalDuration += event.duration;

      // Track time range
      if (event.timestamp < minTimestamp) minTimestamp = event.timestamp;
      if (event.timestamp > maxTimestamp) maxTimestamp = event.timestamp;

      // Aggregate by hour
      const hour = new Date(event.timestamp).getHours();
      byHour[hour] = (byHour[hour] || 0) + event.duration;

      // Aggregate by category
      const category = event.category || 'other';
      byCategory[category] = (byCategory[category] || 0) + event.duration;

      // Aggregate by app
      if (event.app_name) {
        const existing = byAppMap.get(event.app_name);
        if (existing) {
          existing.duration += event.duration;
        } else {
          byAppMap.set(event.app_name, {
            duration: event.duration,
            category: category,
          });
        }
      }
    }

    // Convert app map to array and sort
    const byApp = Array.from(byAppMap.entries())
      .map(([app_name, data]) => ({
        app_name,
        duration: data.duration,
        category: data.category,
      }))
      .sort((a, b) => b.duration - a.duration);

    return {
      total_events: events.length,
      total_duration: totalDuration,
      avg_duration: events.length > 0 ? Math.round(totalDuration / events.length) : 0,
      by_hour: byHour,
      by_category: byCategory,
      by_app: byApp,
      date_range: {
        start: minTimestamp,
        end: maxTimestamp,
      },
    };
  }

  /**
   * Get recent insights (cached)
   */
  async getRecentInsights(userId: string, maxAge: number = 24 * 60 * 60 * 1000): Promise<BehaviorInsight | null> {
    try {
      // Check if we have cached insights in user_portraits table
      const result = await query(
        `SELECT portrait_data, created_at
        FROM user_portraits
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const portrait = result.rows[0];
      const age = Date.now() - new Date(portrait.created_at).getTime();

      if (age > maxAge) {
        logger.debug({ userId, age }, 'Cached insights too old');
        return null;
      }

      // Convert portrait to insight
      const data = JSON.parse(portrait.portrait_data);
      return {
        work_style: data.work_style,
        peak_hours: data.peak_productivity_hours,
        total_work_time: data.total_focus_time,
        total_focus_sessions: 0,
        avg_focus_duration: data.avg_focus_duration,
        most_used_apps: data.top_work_apps.map((app: any) => ({
          app_name: app.app_name,
          category: app.category,
          duration_seconds: app.duration,
          percentage: 0,
          event_count: 0,
        })),
        category_distribution: data.category_breakdown,
        distractions: data.top_distractions.map((d: any) => d.app_name),
        generated_at: new Date(portrait.created_at).getTime(),
        data_range: data.data_range,
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get recent insights');
      return null;
    }
  }

  /**
   * Store portrait in database
   */
  async storePortrait(userId: string, portrait: UserPortrait): Promise<void> {
    try {
      await query(
        `INSERT INTO user_portraits (user_id, portrait_data, created_at, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE
          SET portrait_data = EXCLUDED.portrait_data,
              updated_at = CURRENT_TIMESTAMP`,
        [userId, JSON.stringify(portrait)]
      );

      logger.info({ userId, workStyle: portrait.work_style }, 'User portrait stored');
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to store portrait');
      throw new DatabaseError('Failed to store user portrait', error as Error);
    }
  }

  /**
   * Get stored portrait
   */
  async getStoredPortrait(userId: string): Promise<UserPortrait | null> {
    try {
      const result = await query(
        `SELECT portrait_data, created_at, updated_at
        FROM user_portraits
        WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const portrait = JSON.parse(result.rows[0].portrait_data);
      return portrait as UserPortrait;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get stored portrait');
      return null;
    }
  }
}

// Export singleton instance
export const behaviorAnalyzer = new BehaviorAnalyzer();
