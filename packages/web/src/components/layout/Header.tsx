import { NavLink, useNavigate } from 'react-router-dom';
import { Home, Clock, BarChart3, Settings, LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useUserStore } from '@/stores/useUserStore';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/Button';
import { motion } from 'framer-motion';

const navItems = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/timeline', label: 'Timeline', icon: Clock },
  { to: '/analysis', label: 'Analysis', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Header() {
  const { user, logout } = useUserStore();
  const { toggleSidebar, toggleDarkMode, darkMode } = useUIStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Logo and hamburger menu */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors lg:hidden"
            aria-label="Toggle sidebar"
          >
            <Menu className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2"
          >
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">L</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 hidden sm:block">
              Lifespan
            </h1>
          </motion.div>
        </div>

        {/* Navigation - Desktop */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => {
                const baseStyles =
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors';
                const activeStyles =
                  'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300';
                const inactiveStyles =
                  'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800';

                return `${baseStyles} ${isActive ? activeStyles : inactiveStyles}`;
              }}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          {/* Dark mode toggle */}
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Toggle dark mode"
          >
            {darkMode ? (
              <Sun className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            ) : (
              <Moon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            )}
          </button>

          {/* User menu */}
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 dark:text-slate-400 hidden sm:block">
                {user.email}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                aria-label="Logout"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile navigation */}
      <nav className="lg:hidden flex items-center gap-1 px-4 pb-3 overflow-x-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => {
              const baseStyles =
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors';
              const activeStyles =
                'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300';
              const inactiveStyles =
                'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800';

              return `${baseStyles} ${isActive ? activeStyles : inactiveStyles}`;
            }}
          >
            <item.icon className="w-3.5 h-3.5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
