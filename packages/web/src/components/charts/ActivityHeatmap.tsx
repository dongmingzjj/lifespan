import { useMemo } from 'react';
import { formatDuration } from '@/lib/formatters';

interface ActivityHeatmapProps {
  data: Array<{
    timestamp: number;
    duration: number;
  }>;
}

interface HeatmapCell {
  day: number;
  hour: number;
  duration: number;
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  const heatmapData = useMemo(() => {
    // Initialize 7 days x 24 hours grid
    const grid: HeatmapCell[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ day: 0, hour: 0, duration: 0 }))
    );

    // Populate grid with data
    data.forEach((item) => {
      const date = new Date(item.timestamp);
      const day = date.getDay();
      const hour = date.getHours();

      if (grid[day] && grid[day][hour]) {
        grid[day][hour].duration += item.duration;
        grid[day][hour].day = day;
        grid[day][hour].hour = hour;
      }
    });

    return grid;
  }, [data]);

  // Find max duration for color scaling
  const maxDuration = useMemo(() => {
    let max = 0;
    heatmapData.forEach((row) => {
      row.forEach((cell) => {
        if (cell.duration > max) max = cell.duration;
      });
    });
    return max;
  }, [heatmapData]);

  const getCellColor = (duration: number) => {
    if (duration === 0) return 'bg-slate-100 dark:bg-slate-800';
    const intensity = duration / maxDuration;
    if (intensity < 0.2) return 'bg-primary-100 dark:bg-primary-900/30';
    if (intensity < 0.4) return 'bg-primary-200 dark:bg-primary-800/50';
    if (intensity < 0.6) return 'bg-primary-300 dark:bg-primary-700/60';
    if (intensity < 0.8) return 'bg-primary-400 dark:bg-primary-600/70';
    return 'bg-primary-600 dark:bg-primary-500';
  };

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Hour labels */}
        <div className="flex ml-12 mb-2">
          {Array.from({ length: 24 }, (_, i) => (
            <div
              key={i}
              className="flex-1 text-center text-xs text-slate-500 dark:text-slate-400"
            >
              {i % 3 === 0 ? `${i}:00` : ''}
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        <div className="flex flex-col gap-1">
          {heatmapData.map((row, dayIndex) => (
            <div key={dayIndex} className="flex items-center gap-1">
              {/* Day label */}
              <div className="w-12 text-xs text-slate-600 dark:text-slate-400 text-right pr-2">
                {dayNames[dayIndex]}
              </div>

              {/* Hour cells */}
              <div className="flex gap-0.5 flex-1">
                {row.map((cell, hourIndex) => (
                  <div
                    key={`${dayIndex}-${hourIndex}`}
                    className={`flex-1 aspect-square rounded-sm ${getCellColor(
                      cell.duration
                    )} hover:ring-2 hover:ring-primary-400 transition-all cursor-pointer`}
                    title={`${dayNames[dayIndex]} ${hourIndex}:00 - ${formatDuration(
                      cell.duration
                    )}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-2 mt-4 text-xs text-slate-600 dark:text-slate-400">
          <span>Less</span>
          <div className="flex gap-0.5">
            <div className="w-4 h-4 rounded-sm bg-slate-100 dark:bg-slate-800" />
            <div className="w-4 h-4 rounded-sm bg-primary-100 dark:bg-primary-900/30" />
            <div className="w-4 h-4 rounded-sm bg-primary-200 dark:bg-primary-800/50" />
            <div className="w-4 h-4 rounded-sm bg-primary-300 dark:bg-primary-700/60" />
            <div className="w-4 h-4 rounded-sm bg-primary-400 dark:bg-primary-600/70" />
            <div className="w-4 h-4 rounded-sm bg-primary-600 dark:bg-primary-500" />
          </div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
