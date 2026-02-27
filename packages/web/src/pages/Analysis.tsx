import { motion } from 'framer-motion';
import { Brain, Target, TrendingUp, Lightbulb, Award, Clock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useTimeline } from '@/hooks/useTimeline';
import { formatDuration, formatPercentage } from '@/lib/formatters';
import { AppPieChart } from '@/components/charts/AppPieChart';

export function Analysis() {
  const { timelineData, isLoading } = useTimeline('week');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-500 dark:text-slate-400">Loading analysis...</p>
      </div>
    );
  }

  const { totalDuration, categoryBreakdown, appUsage } = timelineData;

  // Calculate user portrait metrics
  const workPercentage = (categoryBreakdown.find((c) => c.category === 'work')?.percentage || 0) * 100;
  const entertainmentPercentage = (categoryBreakdown.find((c) => c.category === 'entertainment')?.percentage || 0) * 100;
  const learningPercentage = (categoryBreakdown.find((c) => c.category === 'learning')?.percentage || 0) * 100;

  const productivityScore = Math.round(workPercentage + learningPercentage * 0.5);
  const focusScore = Math.round(100 - entertainmentPercentage * 0.5);
  const balanceScore = Math.round((workPercentage + learningPercentage + entertainmentPercentage) / 3);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
          Analysis
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          AI-powered insights into your digital behavior
        </p>
      </motion.div>

      {/* User Portrait Scores */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {/* Productivity Score */}
        <Card className="bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/30 border-primary-200 dark:border-primary-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-primary-700 dark:text-primary-300">Productivity</p>
              <p className="text-4xl font-bold text-primary-900 dark:text-primary-100 mt-2">
                {productivityScore}
                <span className="text-lg">/100</span>
              </p>
            </div>
            <div className="p-3 rounded-lg bg-primary-200 dark:bg-primary-800/50">
              <TrendingUp className="w-8 h-8 text-primary-600 dark:text-primary-400" />
            </div>
          </div>
        </Card>

        {/* Focus Score */}
        <Card className="bg-gradient-to-br from-secondary-50 to-secondary-100 dark:from-secondary-900/20 dark:to-secondary-800/30 border-secondary-200 dark:border-secondary-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-secondary-700 dark:text-secondary-300">Focus</p>
              <p className="text-4xl font-bold text-secondary-900 dark:text-secondary-100 mt-2">
                {focusScore}
                <span className="text-lg">/100</span>
              </p>
            </div>
            <div className="p-3 rounded-lg bg-secondary-200 dark:bg-secondary-800/50">
              <Target className="w-8 h-8 text-secondary-600 dark:text-secondary-400" />
            </div>
          </div>
        </Card>

        {/* Balance Score */}
        <Card className="bg-gradient-to-br from-accent-50 to-accent-100 dark:from-accent-900/20 dark:to-accent-800/30 border-accent-200 dark:border-accent-800 sm:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-accent-700 dark:text-accent-300">Balance</p>
              <p className="text-4xl font-bold text-accent-900 dark:text-accent-100 mt-2">
                {balanceScore}
                <span className="text-lg">/100</span>
              </p>
            </div>
            <div className="p-3 rounded-lg bg-accent-200 dark:bg-accent-800/50">
              <Award className="w-8 h-8 text-accent-600 dark:text-accent-400" />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Behavior Patterns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Time Distribution</CardTitle>
              <CardDescription>How you spend your time across categories</CardDescription>
            </CardHeader>
            <div className="h-[300px]">
              <AppPieChart
                data={categoryBreakdown.map((c) => ({
                  name: c.category,
                  duration: c.duration,
                  category: c.category,
                }))}
              />
            </div>
          </Card>
        </motion.div>

        {/* Insights */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary-600" />
                AI Insights
              </CardTitle>
              <CardDescription>Personalized recommendations based on your data</CardDescription>
            </CardHeader>
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary-50 dark:bg-primary-900/20">
                <Lightbulb className="w-5 h-5 text-primary-600 dark:text-primary-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">Peak Hours</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Your most productive hours are 9 AM - 12 PM. Schedule important tasks during this time.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary-50 dark:bg-secondary-900/20">
                <Target className="w-5 h-5 text-secondary-600 dark:text-secondary-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">Focus Score</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {focusScore > 70
                      ? 'Great focus! You maintain deep work sessions effectively.'
                      : 'Try reducing context switching with focused work blocks.'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-accent-50 dark:bg-accent-900/20">
                <Clock className="w-5 h-5 text-accent-600 dark:text-accent-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">Work-Life Balance</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {balanceScore > 60
                      ? 'Good balance between work and personal activities.'
                      : 'Consider allocating more time for rest and recreation.'}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Goals & Habits */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Goals & Habits</CardTitle>
            <CardDescription>Track your progress and build better habits</CardDescription>
          </CardHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Daily Work Goal
                </span>
                <Badge variant="primary">6h / 8h</Badge>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all"
                  style={{ width: '75%' }}
                />
              </div>
            </div>

            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Learning Goal
                </span>
                <Badge variant="secondary">1.5h / 2h</Badge>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2">
                <div
                  className="bg-secondary-600 h-2 rounded-full transition-all"
                  style={{ width: '75%' }}
                />
              </div>
            </div>

            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Deep Work Sessions
                </span>
                <Badge variant="accent">3 / day</Badge>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2">
                <div
                  className="bg-accent-600 h-2 rounded-full transition-all"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Screen Time Limit
                </span>
                <Badge variant="success">5h / 8h</Badge>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all"
                  style={{ width: '62.5%' }}
                />
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Top Apps Analysis */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Top Applications</CardTitle>
            <CardDescription>Your most used applications this week</CardDescription>
          </CardHeader>
          <div className="space-y-3">
            {appUsage.slice(0, 5).map((app, index) => (
              <div key={app.name} className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center text-white font-bold text-sm">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{app.name}</p>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 mt-1">
                    <div
                      className="bg-primary-600 h-2 rounded-full"
                      style={{
                        width: `${(app.duration / totalDuration) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatDuration(app.duration, 'short')}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {formatPercentage(app.duration / totalDuration)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
