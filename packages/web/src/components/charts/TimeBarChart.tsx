import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';
import { formatDuration } from '@/lib/formatters';

interface TimeBarChartProps {
  data: Array<{
    hour: number;
    duration: number;
    category?: string;
  }>;
  height?: number;
}

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white dark:bg-slate-900 p-3 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {data.hour}:00 - {data.hour + 1}:00
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {formatDuration(data.duration)}
        </p>
      </div>
    );
  }
  return null;
}

export function TimeBarChart({ data, height = 300 }: TimeBarChartProps) {
  // Group data by hour and aggregate duration
  const chartData = data.reduce((acc, item) => {
    const hour = item.hour;
    const existing = acc.find((d) => d.hour === hour);
    if (existing) {
      existing.duration += item.duration;
    } else {
      acc.push({ hour, duration: item.duration });
    }
    return acc;
  }, [] as Array<{ hour: number; duration: number }>);

  // Sort by hour
  chartData.sort((a, b) => a.hour - b.hour);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" />
        <XAxis
          dataKey="hour"
          tickFormatter={(hour) => `${hour}:00`}
          className="text-sm text-slate-600 dark:text-slate-400"
        />
        <YAxis
          tickFormatter={(value) => `${value / 1000 / 60}m`}
          className="text-sm text-slate-600 dark:text-slate-400"
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar
          dataKey="duration"
          fill="#2563eb"
          radius={[4, 4, 0, 0]}
          className="fill-primary-600 hover:fill-primary-700 transition-colors"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
