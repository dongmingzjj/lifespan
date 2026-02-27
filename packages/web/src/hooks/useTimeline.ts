import { useMemo } from 'react';
import { useEvents } from './useEvents';
import { getDateRange, groupBy, sortBy } from '@/lib/utils';
import type { AppUsageEvent, AppUsage } from '@lifespan/types';

interface TimelineData {
  totalDuration: number;
  appUsage: AppUsage[];
  hourlyData: Array<{ hour: number; duration: number }>;
  dailyData: Array<{ date: string; duration: number }>;
  categoryBreakdown: Array<{ category: string; duration: number; percentage: number }>;
}

export function useTimeline(period: 'today' | 'week' | 'month' | 'year' = 'today') {
  const { start } = getDateRange(period);
  const since = Math.floor(start.getTime() / 1000);

  const { data, isLoading, error } = useEvents({
    since,
    limit: 1000,
  });

  const timelineData = useMemo((): TimelineData => {
    if (!data?.events) {
      return {
        totalDuration: 0,
        appUsage: [],
        hourlyData: [],
        dailyData: [],
        categoryBreakdown: [],
      };
    }

    const events = data.events as AppUsageEvent[];

    // Calculate total duration
    const totalDuration = events.reduce((sum, event) => sum + (event.duration || 0), 0);

    // Group by app name
    const appGroups = groupBy(events.filter((e) => e.appName), 'appName');
    const appUsage: AppUsage[] = Object.entries(appGroups).map(([name, evs]) => ({
      name,
      duration: evs.reduce((sum, e) => sum + (e.duration || 0), 0),
      category: evs[0]?.category || 'other',
    }));

    // Sort by duration and take top 10
    const topApps = sortBy(appUsage, 'duration', 'desc').slice(0, 10);

    // Group by hour
    const hourlyGroups = groupBy(events, (event) => {
      const date = new Date(event.timestamp);
      return String(date.getHours());
    });

    const hourlyData = Object.entries(hourlyGroups).map(([hourStr, evs]) => ({
      hour: parseInt(hourStr, 10),
      duration: evs.reduce((sum, e) => sum + (e.duration || 0), 0),
    }));

    // Sort by hour
    hourlyData.sort((a, b) => a.hour - b.hour);

    // Group by day
    const dailyGroups = groupBy(events, (event) => {
      const date = new Date(event.timestamp);
      return date.toDateString();
    });

    const dailyData = Object.entries(dailyGroups).map(([date, events]) => ({
      date,
      duration: events.reduce((sum, e) => sum + (e.duration || 0), 0),
    }));

    // Group by category
    const categoryGroups = groupBy(events.filter((e) => e.category), 'category');
    const categoryBreakdown = Object.entries(categoryGroups).map(([category, events]) => ({
      category,
      duration: events.reduce((sum, e) => sum + (e.duration || 0), 0),
      percentage: 0,
    }));

    // Calculate percentages
    categoryBreakdown.forEach((c) => {
      c.percentage = totalDuration > 0 ? c.duration / totalDuration : 0;
    });

    return {
      totalDuration,
      appUsage: topApps,
      hourlyData,
      dailyData,
      categoryBreakdown,
    };
  }, [data]);

  return {
    timelineData,
    isLoading,
    error,
    events: data?.events || [],
  };
}
