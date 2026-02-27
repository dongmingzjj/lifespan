import { NavLink } from 'react-router-dom';
import { Home, Clock, BarChart3, Settings } from 'lucide-react';
import { useUIStore } from '@/stores/useUIStore';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/timeline', label: 'Timeline', icon: Clock },
  { to: '/analysis', label: 'Analysis', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { sidebarOpen } = useUIStore();

  if (!sidebarOpen) return null;

  return (
    <aside
      className={cn(
        'fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        className
      )}
    >
      <div className="flex flex-col h-full p-4">
        {/* Logo */}
        <div className="flex items-center gap-2 px-2 py-4 mb-6">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">L</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Lifespan
          </h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => {
                const baseStyles =
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
                const activeStyles =
                  'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300';
                const inactiveStyles =
                  'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800';

                return `${baseStyles} ${isActive ? activeStyles : inactiveStyles}`;
              }}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
            © 2026 Lifespan
          </p>
        </div>
      </div>
    </aside>
  );
}
