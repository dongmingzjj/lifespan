import { motion } from 'framer-motion';
import { Clock, TrendingUp, Activity, Zap } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { TimeBarChart } from '@/components/charts/TimeBarChart';
import { AppPieChart } from '@/components/charts/AppPieChart';
import { ActivityHeatmap } from '@/components/charts/ActivityHeatmap';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { useTimeline } from '@/hooks/useTimeline';
import { formatDuration, formatPercentage } from '@/lib/formatters';
import { useState } from 'react';

const periods = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
] as const;

export function Dashboard() {
  const [period, setPeriod] = useState<typeof periods[number]['value']>('today');
  const { timelineData, isLoading, error } = useTimeline(period);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-lg font-medium text-red-600 dark:text-red-400 mb-2">
            Error loading dashboard
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-400">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  const { totalDuration, appUsage, hourlyData, categoryBreakdown } = timelineData;

  // Calculate stats
  const topApp = appUsage[0];
  const topCategory = categoryBreakdown.sort((a, b) => b.duration - a.duration)[0];
  const productivityScore = Math.round(
    (categoryBreakdown.find((c) => c.category === 'work')?.percentage || 0) * 100
  );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
            Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            {formatDuration(totalDuration)} of activity tracked
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
          {periods.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                period === p.value
                  ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Stats cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        <Card className="hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <Clock className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Time</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {formatDuration(totalDuration, 'short')}
              </p>
            </div>
          </div>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-secondary-100 dark:bg-secondary-900/30">
              <TrendingUp className="w-6 h-6 text-secondary-600 dark:text-secondary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Top App</p>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {topApp?.name || 'N/A'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-accent-100 dark:bg-accent-900/30">
              <Activity className="w-6 h-6 text-accent-600 dark:text-accent-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Top Category</p>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 capitalize">
                {topCategory?.category || 'N/A'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/30">
              <Zap className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Productivity</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {productivityScore}%
              </p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Hourly Activity</CardTitle>
              <CardDescription>Your activity throughout the day</CardDescription>
            </CardHeader>
            <div className="h-[300px]">
              <TimeBarChart data={hourlyData} />
            </div>
          </Card>
        </motion.div>

        {/* App distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>App Distribution</CardTitle>
              <CardDescription>Top 10 apps by usage time</CardDescription>
            </CardHeader>
            <div className="h-[300px]">
              <AppPieChart data={appUsage} />
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Activity heatmap */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Activity Heatmap</CardTitle>
            <CardDescription>Your activity patterns across the week</CardDescription>
          </CardHeader>
          <ActivityHeatmap data={[]} />
        </Card>
      </motion.div>

      {/* AI Insights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Card className="bg-gradient-to-br from-primary-50 to-secondary-50 dark:from-primary-900/20 dark:to-secondary-900/20 border-primary-200 dark:border-primary-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5" />
              AI Insights
            </CardTitle>
          </CardHeader>
          <div className="space-y-3">
            <p className="text-slate-700 dark:text-slate-300">
              🎯 Your peak productivity hours are between <strong>9 AM - 12 PM</strong>
            </p>
            <p className="text-slate-700 dark:text-slate-300">
              💡 You spend {formatPercentage(topCategory?.percentage || 0)} of your time on{' '}
              <strong className="capitalize">{topCategory?.category}</strong> activities
            </p>
            <p className="text-slate-700 dark:text-slate-300">
              📈 Consider reducing entertainment time during work hours for better focus
            </p>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
