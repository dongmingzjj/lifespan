import { useState } from 'react';
import { motion } from 'framer-motion';
import { Filter, Download, Search, ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { TimelineChart } from '@/components/charts/TimelineChart';
import { useTimeline } from '@/hooks/useTimeline';
import { formatDate, formatDuration } from '@/lib/formatters';
import type { AppUsageEvent } from '@lifespan/types';

const categories = [
  { value: 'all', label: 'All Categories' },
  { value: 'work', label: 'Work' },
  { value: 'communication', label: 'Communication' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'learning', label: 'Learning' },
  { value: 'utility', label: 'Utility' },
  { value: 'other', label: 'Other' },
] as const;

export function Timeline() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<AppUsageEvent | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { events, isLoading } = useTimeline('today');

  // Filter events
  const filteredEvents = events.filter((event: any) => {
    const matchesSearch =
      !searchQuery ||
      event.appName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.windowTitle?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === 'all' || event.category === selectedCategory;

    return matchesSearch && matchesCategory;
  }) as AppUsageEvent[];

  const handleExport = () => {
    const data = filteredEvents.map((e) => ({
      time: new Date(e.timestamp).toISOString(),
      app: e.appName,
      title: e.windowTitle,
      duration: e.duration,
      category: e.category,
    }));

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifespan-timeline-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
            Timeline
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            {filteredEvents.length} events recorded
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="w-4 h-4" />
            Filters
            {showFilters && <ChevronDown className="w-4 h-4" />}
          </Button>
          <Button variant="primary" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </motion.div>

      {/* Filters */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="card p-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search apps or windows..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Category filter */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Category
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="input"
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </motion.div>
      )}

      {/* Timeline */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="p-6">
          <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-slate-500 dark:text-slate-400">Loading timeline...</p>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <p className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
                  No events found
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Try adjusting your filters or check back later
                </p>
              </div>
            ) : (
              <TimelineChart events={filteredEvents} onEventClick={setSelectedEvent} />
            )}
          </div>
        </Card>
      </motion.div>

      {/* Event detail modal */}
      <Modal
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title="Event Details"
        size="md"
      >
        {selectedEvent && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Application</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {selectedEvent.appName || 'Unknown'}
              </p>
            </div>

            {selectedEvent.windowTitle && (
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Window Title</p>
                <p className="text-base text-slate-900 dark:text-slate-100">
                  {selectedEvent.windowTitle}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Duration</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {formatDuration(selectedEvent.duration)}
                </p>
              </div>

              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Category</p>
                <Badge variant="secondary" className="mt-1 capitalize">
                  {selectedEvent.category}
                </Badge>
              </div>
            </div>

            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Timestamp</p>
              <p className="text-base text-slate-900 dark:text-slate-100">
                {formatDate(selectedEvent.timestamp, 'full')}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">Device ID</p>
              <p className="text-sm font-mono text-slate-900 dark:text-slate-100">
                {selectedEvent.deviceId}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
