import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { formatDuration, formatDate } from '@/lib/formatters';
import { getCategoryColor } from '@/lib/utils';

interface TimelineChartProps {
  events: Array<{
    id: string;
    timestamp: number;
    duration: number;
    appName?: string;
    windowTitle?: string;
    category?: string;
    type?: string;
  }>;
  onEventClick?: (event: any) => void;
}

export function TimelineChart({ events, onEventClick }: TimelineChartProps) {
  const timelineEvents = useMemo(() => {
    return events
      .filter((e) => e.duration > 0)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [events]);

  if (timelineEvents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
        <p>No timeline data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {timelineEvents.map((event, index) => {
        const categoryColor = event.category
          ? getCategoryColor(event.category)
          : '#64748b';

        return (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.02 }}
            className="flex items-center gap-4 p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            onClick={() => onEventClick?.(event)}
          >
            {/* Time indicator */}
            <div className="flex-shrink-0 w-16 text-sm text-slate-600 dark:text-slate-400">
              {formatDate(event.timestamp, 'time')}
            </div>

            {/* Category indicator */}
            <div
              className="flex-shrink-0 w-3 h-12 rounded"
              style={{ backgroundColor: categoryColor }}
            />

            {/* Event info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {event.appName || event.windowTitle || event.type}
                </p>
                <span className="text-sm text-slate-600 dark:text-slate-400 flex-shrink-0">
                  {formatDuration(event.duration, 'short')}
                </span>
              </div>
              {event.windowTitle && event.appName && (
                <p className="text-xs text-slate-500 dark:text-slate-500 truncate">
                  {event.windowTitle}
                </p>
              )}
            </div>

            {/* Duration bar */}
            <div
              className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex-shrink-0"
              style={{ width: `${Math.min(event.duration / 1000 / 60, 100)}px` }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  backgroundColor: categoryColor,
                  width: '100%',
                }}
              />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
