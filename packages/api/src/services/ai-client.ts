/**
 * Zhipu AI Client
 * Integrates with Zhipu AI (智谱AI) GLM models for behavior analysis
 * @module services/ai-client
 */

import { logger } from '../utils/logger.js';
import type { AggregatedStats, BehaviorInsight, UserPortrait, Recommendation } from '../types/analysis.types';

/**
 * Message format for chat completion
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Chat completion response
 */
interface ChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Zhipu AI client configuration
 */
interface AIClientConfig {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

/**
 * Zhipu AI Client
 * Provides access to GLM-4, GLM-4-Flash, GLM-4-Air models
 */
export class AIClient {
  private apiKey: string;
  private baseURL: string;
  private timeout: number;
  private enabled: boolean;

  constructor(config: AIClientConfig = {}) {
    this.apiKey = config.apiKey || process.env.ZHIPU_API_KEY || '';
    this.baseURL = config.baseURL || 'https://open.bigmodel.cn/api/paas/v4/';
    this.timeout = config.timeout || 30000; // 30s default

    // AI is optional - work without API key
    this.enabled = !!this.apiKey && this.apiKey.length > 0;

    if (!this.enabled) {
      logger.warn('ZHIPU_API_KEY not configured, AI features will be disabled');
    } else {
      logger.info('Zhipu AI client initialized');
    }
  }

  /**
   * Check if AI client is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send chat completion request
   */
  async chat(
    messages: ChatMessage[],
    model: string = 'glm-4',
    temperature: number = 0.7,
    maxTokens: number = 2000
  ): Promise<string> {
    if (!this.enabled) {
      throw new Error('Zhipu AI is not enabled (no API key configured)');
    }

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseURL}chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({
          status: response.status,
          error: errorText,
        }, 'Zhipu AI API error');

        throw new Error(`Zhipu AI API error: ${response.status} ${response.statusText}`);
      }

      const data: ChatResponse = await response.json();
      const content = data.choices[0]?.message?.content || '';

      const duration = Date.now() - startTime;
      const tokens = data.usage?.total_tokens || 0;

      logger.info({
        model,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: tokens,
        duration,
      }, 'Zhipu AI chat completion completed');

      return content;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error({ duration }, 'Zhipu AI request timeout');
        throw new Error('Zhipu AI request timeout');
      }

      logger.error({
        err: error,
        duration,
      }, 'Zhipu AI chat completion failed');

      throw error;
    }
  }

  /**
   * Analyze user behavior using AI
   * Falls back to statistical analysis if AI is disabled
   */
  async analyzeBehavior(stats: AggregatedStats): Promise<BehaviorInsight> {
    if (!this.enabled) {
      logger.info('AI disabled, returning statistical behavior insight');
      return this.getStatisticalInsight(stats);
    }

    const prompt = this.buildBehaviorAnalysisPrompt(stats);

    try {
      const response = await this.chat(
        [
          {
            role: 'system',
            content: BEHAVIOR_ANALYSIS_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        'glm-4',
        0.3, // Lower temperature for consistent analysis
        2000
      );

      return this.parseBehaviorInsight(response, stats);
    } catch (error) {
      logger.warn({ err: error }, 'AI behavior analysis failed, using statistical fallback');
      return this.getStatisticalInsight(stats);
    }
  }

  /**
   * Generate user portrait using AI
   */
  async generatePortrait(stats: AggregatedStats): Promise<UserPortrait> {
    if (!this.enabled) {
      logger.info('AI disabled, returning statistical user portrait');
      return this.getStatisticalPortrait(stats);
    }

    const prompt = this.buildPortraitPrompt(stats);

    try {
      const response = await this.chat(
        [
          {
            role: 'system',
            content: PORTRAIT_GENERATION_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        'glm-4',
        0.3,
        3000
      );

      return this.parsePortrait(response, stats);
    } catch (error) {
      logger.warn({ err: error }, 'AI portrait generation failed, using statistical fallback');
      return this.getStatisticalPortrait(stats);
    }
  }

  /**
   * Generate recommendations using AI
   */
  async generateRecommendations(
    portrait: UserPortrait,
    stats: AggregatedStats
  ): Promise<Recommendation[]> {
    if (!this.enabled) {
      logger.info('AI disabled, returning statistical recommendations');
      return this.getStatisticalRecommendations(portrait);
    }

    const prompt = this.buildRecommendationsPrompt(portrait);

    try {
      const response = await this.chat(
        [
          {
            role: 'system',
            content: RECOMMENDATIONS_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        'glm-4-flash',
        0.7,
        2000
      );

      return this.parseRecommendations(response);
    } catch (error) {
      logger.warn({ err: error }, 'AI recommendation generation failed, using statistical fallback');
      return this.getStatisticalRecommendations(portrait);
    }
  }

  /**
   * Build prompt for behavior analysis
   */
  private buildBehaviorAnalysisPrompt(stats: AggregatedStats): string {
    const topApps = stats.by_app
      .slice(0, 10)
      .map((app, i) => `${i + 1}. ${app.app_name} (${this.formatDuration(app.duration)}) - ${app.category}`)
      .join('\n');

    const categoryBreakdown = Object.entries(stats.by_category)
      .map(([cat, duration]) => `${cat}: ${this.formatDuration(duration)} (${((duration / stats.total_duration) * 100).toFixed(1)}%)`)
      .join('\n');

    const peakHours = this.getPeakHours(stats.by_hour);

    return `Analyze the following user activity data:

**Time Range**: ${new Date(stats.date_range.start).toLocaleDateString()} to ${new Date(stats.date_range.end).toLocaleDateString()}
**Total Events**: ${stats.total_events}
**Total Activity**: ${this.formatDuration(stats.total_duration)}

**Top Applications**:
${topApps}

**Activity by Category**:
${categoryBreakdown}

**Peak Activity Hours**: ${peakHours}

Please analyze and provide a JSON response with:
- work_style: "deep_work" | "multitask" | "balanced" | "unknown"
- peak_hours: array of time ranges (e.g., ["9-11", "14-16"])
- total_work_time: total seconds
- total_focus_sessions: estimated count
- avg_focus_duration: average seconds
- most_used_apps: array of {app_name, category, duration_seconds, percentage, event_count}
- category_distribution: object with percentages
- distractions: array of distraction categories

Return ONLY valid JSON, no other text.`;
  }

  /**
   * Build prompt for portrait generation
   */
  private buildPortraitPrompt(stats: AggregatedStats): string {
    return this.buildBehaviorAnalysisPrompt(stats) + `

Additionally, provide:
- peak_productivity_hours: array of time ranges
- least_productive_hours: array of time ranges
- top_work_apps: array of {app_name, duration, category}
- top_distractions: array of {app_name, duration, category}
- daily_work_hours: average hours per day
- avg_focus_duration: average focus session in seconds
- longest_focus_session: longest session in seconds
- total_focus_time: total deep work seconds
- productivity_score: 0-100 score

Return ONLY valid JSON, no other text.`;
  }

  /**
   * Build prompt for recommendations
   */
  private buildRecommendationsPrompt(portrait: UserPortrait): string {
    return `Based on the following user portrait, generate actionable recommendations:

**User Portrait**:
- Work Style: ${portrait.work_style}
- Productivity Score: ${portrait.productivity_score}/100
- Peak Hours: ${portrait.peak_productivity_hours.join(', ')}
- Daily Work Hours: ${portrait.daily_work_hours.toFixed(1)}h
- Avg Focus Duration: ${this.formatDuration(portrait.avg_focus_duration)}
- Top Distractions: ${portrait.top_distractions.map(d => d.app_name).join(', ')}

Please provide 3-5 specific recommendations in JSON format:
[
  {
    "type": "productivity" | "health" | "time_management" | "focus" | "habit",
    "priority": "high" | "medium" | "low",
    "title": "short title",
    "description": "detailed description",
    "actionable_steps": ["step1", "step2"],
    "expected_impact": "what to expect"
  }
]

Return ONLY valid JSON array, no other text.`;
  }

  /**
   * Parse behavior insight from AI response
   */
  private parseBehaviorInsight(response: string, stats: AggregatedStats): BehaviorInsight {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        work_style: parsed.work_style || 'unknown',
        peak_hours: parsed.peak_hours || [],
        total_work_time: parsed.total_work_time || stats.total_duration,
        total_focus_sessions: parsed.total_focus_sessions || 0,
        avg_focus_duration: parsed.avg_focus_duration || stats.avg_duration,
        most_used_apps: parsed.most_used_apps || this.buildAppUsage(stats),
        category_distribution: parsed.category_distribution || this.getCategoryPercentages(stats),
        distractions: parsed.distractions || [],
        generated_at: Date.now(),
        data_range: stats.date_range,
      };
    } catch (error) {
      logger.error({ err: error, response: response.substring(0, 200) }, 'Failed to parse AI response');
      return this.getStatisticalInsight(stats);
    }
  }

  /**
   * Parse user portrait from AI response
   */
  private parsePortrait(response: string, stats: AggregatedStats): UserPortrait {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        user_id: '', // Set by caller
        work_style: parsed.work_style || 'unknown',
        peak_productivity_hours: parsed.peak_productivity_hours || [],
        least_productive_hours: parsed.least_productivity_hours || [],
        top_work_apps: parsed.top_work_apps || [],
        top_distractions: parsed.top_distractions || [],
        daily_work_hours: parsed.daily_work_hours || (stats.total_duration / 86400 / 30),
        avg_focus_duration: parsed.avg_focus_duration || stats.avg_duration,
        longest_focus_session: parsed.longest_focus_session || Math.max(...stats.by_app.map(a => a.duration)),
        total_focus_time: parsed.total_focus_time || stats.total_duration,
        category_breakdown: this.getCategoryPercentages(stats),
        productivity_score: parsed.productivity_score || 50,
        generated_at: Date.now(),
        data_range: stats.date_range,
      };
    } catch (error) {
      logger.error({ err: error, response: response.substring(0, 200) }, 'Failed to parse portrait');
      return this.getStatisticalPortrait(stats);
    }
  }

  /**
   * Parse recommendations from AI response
   */
  private parseRecommendations(response: string): Recommendation[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return parsed.map((rec: any) => ({
        id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        type: rec.type || 'productivity',
        priority: rec.priority || 'medium',
        title: rec.title || 'Recommendation',
        description: rec.description || '',
        actionable_steps: rec.actionable_steps || [],
        expected_impact: rec.expected_impact || '',
        created_at: Date.now(),
      }));
    } catch (error) {
      logger.error({ err: error, response: response.substring(0, 200) }, 'Failed to parse recommendations');
      return [];
    }
  }

  /**
   * Statistical fallback for behavior insight
   */
  private getStatisticalInsight(stats: AggregatedStats): BehaviorInsight {
    const workStyle = this.determineWorkStyle(stats);
    const peakHours = this.getPeakHours(stats.by_hour);

    return {
      work_style: workStyle,
      peak_hours: peakHours,
      total_work_time: stats.total_duration,
      total_focus_sessions: Math.floor(stats.total_events / 3),
      avg_focus_duration: stats.avg_duration,
      most_used_apps: this.buildAppUsage(stats),
      category_distribution: this.getCategoryPercentages(stats),
      distractions: this.identifyDistractions(stats),
      generated_at: Date.now(),
      data_range: stats.date_range,
    };
  }

  /**
   * Statistical fallback for user portrait
   */
  private getStatisticalPortrait(stats: AggregatedStats): UserPortrait {
    const workStyle = this.determineWorkStyle(stats);
    const peakHours = this.getPeakHours(stats.by_hour);
    const categories = this.getCategoryPercentages(stats);

    const workApps = stats.by_app
      .filter(app => app.category === 'work' || app.category === 'learning')
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map(app => ({ app_name: app.app_name, duration: app.duration, category: app.category }));

    const distractions = stats.by_app
      .filter(app => app.category === 'entertainment' || app.category === 'other')
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map(app => ({ app_name: app.app_name, duration: app.duration, category: app.category }));

    const daysInRange = Math.max(1, (stats.date_range.end - stats.date_range.start) / 86400000);
    const productivityScore = this.calculateProductivityScore(stats, categories);

    return {
      user_id: '',
      work_style: workStyle,
      peak_productivity_hours: peakHours,
      least_productive_hours: this.getLeastProductiveHours(stats.by_hour),
      top_work_apps: workApps,
      top_distractions: distractions,
      daily_work_hours: stats.total_duration / 86400 / daysInRange,
      avg_focus_duration: stats.avg_duration,
      longest_focus_session: Math.max(...stats.by_app.map(a => a.duration)),
      total_focus_time: stats.total_duration * (categories.work || 0) / 100,
      category_breakdown: categories,
      productivity_score: productivityScore,
      generated_at: Date.now(),
      data_range: stats.date_range,
    };
  }

  /**
   * Statistical fallback for recommendations
   */
  private getStatisticalRecommendations(portrait: UserPortrait): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Productivity recommendations
    if (portrait.productivity_score < 60) {
      recommendations.push({
        id: `rec_${Date.now()}_1`,
        type: 'productivity',
        priority: 'high',
        title: 'Increase Focus Time',
        description: 'Your productivity score suggests room for improvement in focus and work habits.',
        actionable_steps: [
          'Try the Pomodoro technique: 25 minutes work, 5 minutes break',
          'Identify and minimize your top distractions',
          'Schedule important tasks during your peak hours',
        ],
        expected_impact: 'Could increase productivity by 20-30%',
        created_at: Date.now(),
      });
    }

    // Health recommendations
    if (portrait.daily_work_hours > 10) {
      recommendations.push({
        id: `rec_${Date.now()}_2`,
        type: 'health',
        priority: 'high',
        title: 'Reduce Daily Work Hours',
        description: `You're averaging ${portrait.daily_work_hours.toFixed(1)} hours daily. Consider balancing work and rest.`,
        actionable_steps: [
          'Set a hard stop time for work each day',
          'Take regular breaks to prevent burnout',
          'Prioritize tasks and focus on high-impact activities',
        ],
        expected_impact: 'Better work-life balance and sustained productivity',
        created_at: Date.now(),
      });
    }

    // Focus recommendations
    if (portrait.avg_focus_duration < 1800) {
      recommendations.push({
        id: `rec_${Date.now()}_3`,
        type: 'focus',
        priority: 'medium',
        title: 'Build Focus Endurance',
        description: 'Your average focus session is under 30 minutes. Try gradually extending it.',
        actionable_steps: [
          'Start with 30-minute focused blocks',
          'Gradually increase by 5-10 minutes each week',
          'Eliminate notifications during focus time',
        ],
        expected_impact: 'Longer deep work sessions lead to better outcomes',
        created_at: Date.now(),
      });
    }

    // Time management recommendations
    if (portrait.top_distractions.length > 0) {
      recommendations.push({
        id: `rec_${Date.now()}_4`,
        type: 'time_management',
        priority: 'medium',
        title: 'Manage Distractions',
        description: `Your top distractions: ${portrait.top_distractions.slice(0, 3).map(d => d.app_name).join(', ')}`,
        actionable_steps: [
          'Use website blockers during work hours',
          'Schedule specific times for checking entertainment apps',
          'Create a dedicated workspace free from distractions',
        ],
        expected_impact: 'Reclaim 1-2 hours daily for meaningful work',
        created_at: Date.now(),
      });
    }

    return recommendations;
  }

  /**
   * Determine work style from statistics
   */
  private determineWorkStyle(stats: AggregatedStats): 'deep_work' | 'multitask' | 'balanced' | 'unknown' {
    const workRatio = (stats.by_category.work || 0) / stats.total_duration;
    const avgDuration = stats.avg_duration;

    if (avgDuration > 3600 && workRatio > 0.5) {
      return 'deep_work';
    } else if (avgDuration < 600) {
      return 'multitask';
    } else if (workRatio > 0.3) {
      return 'balanced';
    }
    return 'unknown';
  }

  /**
   * Get peak activity hours
   */
  private getPeakHours(byHour: Record<number, number>): string[] {
    const sorted = Object.entries(byHour)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hour]) => parseInt(hour));

    // Group consecutive hours into ranges
    const ranges: string[] = [];
    let start = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === prev + 1) {
        prev = sorted[i];
      } else {
        ranges.push(`${start}-${prev + 1}`);
        start = sorted[i];
        prev = sorted[i];
      }
    }
    ranges.push(`${start}-${prev + 1}`);

    return ranges;
  }

  /**
   * Get least productive hours
   */
  private getLeastProductiveHours(byHour: Record<number, number>): string[] {
    const sorted = Object.entries(byHour)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));

    return sorted.map(h => `${h}-${h + 1}`);
  }

  /**
   * Build app usage array
   */
  private buildAppUsage(stats: AggregatedStats): Array<{
    app_name: string;
    category: string;
    duration_seconds: number;
    percentage: number;
    event_count: number;
  }> {
    return stats.by_app
      .slice(0, 10)
      .map(app => ({
        app_name: app.app_name,
        category: app.category,
        duration_seconds: app.duration,
        percentage: (app.duration / stats.total_duration) * 100,
        event_count: Math.floor(app.duration / stats.avg_duration),
      }));
  }

  /**
   * Get category percentages
   */
  private getCategoryPercentages(stats: AggregatedStats): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [category, duration] of Object.entries(stats.by_category)) {
      result[category] = (duration / stats.total_duration) * 100;
    }
    return result;
  }

  /**
   * Identify distraction categories
   */
  private identifyDistractions(stats: AggregatedStats): string[] {
    const distractions: string[] = [];

    if (stats.by_category.entertainment > stats.total_duration * 0.2) {
      distractions.push('entertainment');
    }
    if (stats.by_category.other > stats.total_duration * 0.15) {
      distractions.push('uncategorized_apps');
    }

    const distractionApps = stats.by_app
      .filter(app => app.category === 'entertainment')
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3)
      .map(app => app.app_name);

    distractions.push(...distractionApps);

    return distractions;
  }

  /**
   * Calculate productivity score
   */
  private calculateProductivityScore(
    stats: AggregatedStats,
    categories: Record<string, number>
  ): number {
    let score = 50;

    // Work ratio increases score
    score += (categories.work || 0) * 0.5;

    // Learning ratio increases score
    score += (categories.learning || 0) * 0.3;

    // Entertainment decreases score
    score -= (categories.entertainment || 0) * 0.3;

    // Focus duration factor
    if (stats.avg_duration > 3600) score += 15;
    else if (stats.avg_duration > 1800) score += 10;
    else if (stats.avg_duration > 900) score += 5;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
}

// System prompts
const BEHAVIOR_ANALYSIS_SYSTEM_PROMPT = `You are an expert behavior analyst specializing in digital productivity and work patterns. Analyze user activity data to extract meaningful insights about work style, productivity patterns, and habits.

Focus on:
1. Work style classification (deep_work, multitask, balanced)
2. Peak productivity hours
3. App usage patterns
4. Attention span and focus duration
5. Distraction identification

Be specific, data-driven, and actionable. Return only valid JSON.`;

const PORTRAIT_GENERATION_SYSTEM_PROMPT = `You are an expert in creating comprehensive user behavioral profiles. Analyze activity data to generate a detailed portrait including work patterns, productivity metrics, and personalized insights.

Provide a holistic view of:
- Work style and productivity patterns
- Peak and low productivity hours
- Top work applications and distractions
- Focus duration metrics
- Productivity score (0-100)

Be thorough but concise. Return only valid JSON.`;

const RECOMMENDATIONS_SYSTEM_PROMPT = `You are a productivity coach providing personalized recommendations based on user behavioral data. Generate actionable, specific, and realistic suggestions that consider the user's actual patterns and habits.

Each recommendation should include:
- Type: productivity, health, time_management, focus, or habit
- Priority: high, medium, or low
- Title: concise summary
- Description: detailed explanation
- Actionable steps: 3-5 specific steps
- Expected impact: realistic outcome

Be supportive and practical. Return only valid JSON array.`;

// Export singleton instance
export const aiClient = new AIClient();
