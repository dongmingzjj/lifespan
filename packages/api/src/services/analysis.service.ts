/**
 * Analysis Service
 * High-level service for behavior analysis and AI recommendations
 * @module services/analysis-service
 */

import { v4 as uuidv4 } from 'uuid';
import { query } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { NotFoundError, DatabaseError } from '../utils/errors.js';
import { behaviorAnalyzer } from './behavior-analyzer.js';
import { aiClient } from './ai-client.js';
import type { InsightData, BehaviorInsight, UserPortrait, Recommendation } from '../types/analysis.types';

/**
 * Analysis Service
 * Orchestrates behavior analysis, portrait generation, and AI recommendations
 */
export class AnalysisService {
  /**
   * Get behavior insights for a user
   * Returns cached insights if available and fresh, otherwise generates new ones
   */
  async getInsights(
    userId: string,
    options: {
      forceRefresh?: boolean;
      days?: number;
      maxCacheAge?: number;
    } = {}
  ): Promise<InsightData> {
    const {
      forceRefresh = false,
      days = 30,
      maxCacheAge = 24 * 60 * 60 * 1000, // 24 hours
    } = options;

    const startTime = Date.now();

    try {
      logger.info({
        userId,
        days,
        forceRefresh,
      }, 'Getting user insights');

      // Try to get cached insights first
      if (!forceRefresh) {
        const cachedInsights = await behaviorAnalyzer.getRecentInsights(userId, maxCacheAge);
        const cachedPortrait = await behaviorAnalyzer.getStoredPortrait(userId);

        if (cachedInsights && cachedPortrait) {
          // Get recommendations
          const recommendations = await this.getRecommendations(userId, cachedPortrait);

          logger.info({
            userId,
            cached: true,
            duration: Date.now() - startTime,
          }, 'Returning cached insights');

          return {
            user_id: userId,
            insights: cachedInsights,
            portrait: cachedPortrait,
            recommendations,
            last_updated: cachedInsights.generated_at,
          };
        }
      }

      // Generate fresh insights
      const insights = await behaviorAnalyzer.analyzePatterns(userId, days);

      // Generate or update portrait
      let portrait = await behaviorAnalyzer.getStoredPortrait(userId);
      if (!portrait || forceRefresh) {
        portrait = await behaviorAnalyzer.generatePortrait(userId, days);
        await behaviorAnalyzer.storePortrait(userId, portrait);
      }

      // Generate recommendations
      const recommendations = await this.generateRecommendations(userId, portrait);

      logger.info({
        userId,
        workStyle: insights.work_style,
        productivityScore: portrait.productivity_score,
        recommendationCount: recommendations.length,
        duration: Date.now() - startTime,
      }, 'Insights generated successfully');

      return {
        user_id: userId,
        insights,
        portrait,
        recommendations,
        last_updated: Date.now(),
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        err: error,
        userId,
        days,
      }, 'Failed to get insights');

      throw new DatabaseError('Failed to get behavior insights', error as Error);
    }
  }

  /**
   * Generate user portrait
   */
  async generatePortrait(userId: string, days: number = 30): Promise<UserPortrait> {
    const startTime = Date.now();

    try {
      logger.info({ userId, days }, 'Generating user portrait');

      // Generate portrait
      const portrait = await behaviorAnalyzer.generatePortrait(userId, days);

      // Store in database
      await behaviorAnalyzer.storePortrait(userId, portrait);

      logger.info({
        userId,
        workStyle: portrait.work_style,
        productivityScore: portrait.productivity_score,
        duration: Date.now() - startTime,
      }, 'User portrait generated and stored');

      return portrait;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      logger.error({
        err: error,
        userId,
        days,
      }, 'Failed to generate portrait');

      throw new DatabaseError('Failed to generate user portrait', error as Error);
    }
  }

  /**
   * Get AI recommendations
   */
  async getRecommendations(userId: string, portrait?: UserPortrait): Promise<Recommendation[]> {
    try {
      // Get portrait if not provided
      if (!portrait) {
        portrait = await behaviorAnalyzer.getStoredPortrait(userId);
        if (!portrait) {
          logger.info({ userId }, 'No portrait found, generating temporary one');
          const events = await this.fetchRecentEvents(userId, 30);
          if (events.length === 0) {
            return [];
          }
          // Generate stats for recommendations
          const stats = this.aggregateEvents(events);
          portrait = await aiClient.generatePortrait(stats);
          portrait.user_id = userId;
        }
      }

      // Get stored recommendations or generate new ones
      const stored = await this.getStoredRecommendations(userId);
      const recAge = Date.now() - (stored[0]?.created_at || 0);

      // Use cached if less than 7 days old
      if (stored.length > 0 && recAge < 7 * 24 * 60 * 60 * 1000) {
        logger.debug({ userId, count: stored.length }, 'Returning cached recommendations');
        return stored;
      }

      // Generate new recommendations
      logger.info({ userId }, 'Generating new recommendations');
      const recommendations = await this.generateRecommendations(userId, portrait);

      // Store in database
      await this.storeRecommendations(userId, recommendations);

      return recommendations;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get recommendations');
      return [];
    }
  }

  /**
   * Generate new recommendations
   */
  private async generateRecommendations(
    userId: string,
    portrait: UserPortrait
  ): Promise<Recommendation[]> {
    try {
      // Get aggregated stats for AI
      const events = await this.fetchRecentEvents(userId, 30);
      if (events.length === 0) {
        return [];
      }

      const stats = this.aggregateEvents(events);
      const recommendations = await aiClient.generateRecommendations(portrait, stats);

      logger.info({
        userId,
        count: recommendations.length,
      }, 'Recommendations generated');

      return recommendations;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to generate recommendations');
      return [];
    }
  }

  /**
   * Fetch recent events for a user
   */
  private async fetchRecentEvents(userId: string, days: number): Promise<any[]> {
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

    return result.rows;
  }

  /**
   * Aggregate events for analysis
   */
  private aggregateEvents(events: any[]): any {
    const byHour: Record<number, number> = {};
    const byCategory: Record<string, number> = {};
    const byAppMap = new Map<string, { duration: number; category: string }>();

    let totalDuration = 0;
    let minTimestamp = Infinity;
    let maxTimestamp = 0;

    for (let i = 0; i < 24; i++) {
      byHour[i] = 0;
    }

    for (const event of events) {
      const duration = event.duration;
      totalDuration += duration;

      if (event.timestamp < minTimestamp) minTimestamp = new Date(event.timestamp).getTime();
      if (event.timestamp > maxTimestamp) maxTimestamp = new Date(event.timestamp).getTime();

      const hour = new Date(event.timestamp).getHours();
      byHour[hour] = (byHour[hour] || 0) + duration;

      const category = event.category || 'other';
      byCategory[category] = (byCategory[category] || 0) + duration;

      if (event.app_name) {
        const existing = byAppMap.get(event.app_name);
        if (existing) {
          existing.duration += duration;
        } else {
          byAppMap.set(event.app_name, { duration, category });
        }
      }
    }

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
   * Store recommendations in database
   */
  private async storeRecommendations(userId: string, recommendations: Recommendation[]): Promise<void> {
    try {
      // Delete old recommendations
      await query(
        'DELETE FROM recommendations WHERE user_id = $1',
        [userId]
      );

      // Insert new recommendations
      for (const rec of recommendations) {
        await query(
          `INSERT INTO recommendations (
            id, user_id, type, priority, title, description,
            actionable_steps, expected_impact, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            rec.id,
            userId,
            rec.type,
            rec.priority,
            rec.title,
            rec.description,
            JSON.stringify(rec.actionable_steps),
            rec.expected_impact,
            new Date(rec.created_at),
          ]
        );
      }

      logger.info({ userId, count: recommendations.length }, 'Recommendations stored');
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to store recommendations');
    }
  }

  /**
   * Get stored recommendations from database
   */
  private async getStoredRecommendations(userId: string): Promise<Recommendation[]> {
    try {
      const result = await query(
        `SELECT
          id,
          type,
          priority,
          title,
          description,
          actionable_steps,
          expected_impact,
          created_at
        FROM recommendations
        WHERE user_id = $1
        ORDER BY created_at DESC`,
        [userId]
      );

      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        priority: row.priority,
        title: row.title,
        description: row.description,
        actionable_steps: JSON.parse(row.actionable_steps || '[]'),
        expected_impact: row.expected_impact,
        created_at: new Date(row.created_at).getTime(),
      }));
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get stored recommendations');
      return [];
    }
  }

  /**
   * Delete user data (GDPR compliance)
   */
  async deleteUserData(userId: string): Promise<void> {
    try {
      logger.info({ userId }, 'Deleting user analysis data');

      await query('DELETE FROM user_portraits WHERE user_id = $1', [userId]);
      await query('DELETE FROM recommendations WHERE user_id = $1', [userId]);

      logger.info({ userId }, 'User analysis data deleted');
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to delete user data');
      throw new DatabaseError('Failed to delete user data', error as Error);
    }
  }
}

// Export singleton instance
export const analysisService = new AnalysisService();
