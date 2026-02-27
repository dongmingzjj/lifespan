import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  TooltipProps,
} from 'recharts';
import { formatDuration, formatPercentage } from '@/lib/formatters';
import { getCategoryColor } from '@/lib/utils';

interface AppPieChartProps {
  data: Array<{
    name: string;
    duration: number;
    category?: string;
  }>;
  height?: number;
}

const COLORS = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#64748b', '#ec4899', '#84cc16'];

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white dark:bg-slate-900 p-3 rounded-lg shadow-lg border border-slate-200 dark:border-slate-800">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {data.name}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {formatDuration(data.duration)}
        </p>
      </div>
    );
  }
  return null;
}

export function AppPieChart({ data, height = 300 }: AppPieChartProps) {
  // Sort by duration and take top 10
  const sortedData = [...data]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);

  const total = sortedData.reduce((sum, item) => sum + item.duration, 0);

  const chartData = sortedData.map((item) => ({
    ...item,
    percentage: item.duration / total,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={(entry) => `${formatPercentage(entry.percentage)}`}
          outerRadius={80}
          fill="#8884d8"
          dataKey="duration"
        >
          {chartData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.category ? getCategoryColor(entry.category) : COLORS[index % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          formatter={(value) => (
            <span className="text-sm text-slate-700 dark:text-slate-300">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
