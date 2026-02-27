import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Shield, Laptop, Download, Bell, Moon, Sun, Copy, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useUserStore } from '@/stores/useUserStore';
import { useUIStore } from '@/stores/useUIStore';

export function Settings() {
  const { user, token } = useUserStore();
  const { darkMode, toggleDarkMode } = useUIStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [userName, setUserName] = useState(user?.name || '');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [weeklyReport, setWeeklyReport] = useState(true);
  const [copied, setCopied] = useState(false);

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement password change
    console.log('Password change requested');
  };

  const handleDataExport = () => {
    // TODO: Implement data export
    const data = {
      user,
      exportDate: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifespan-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAccountDelete = () => {
    if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
      // TODO: Implement account deletion
      console.log('Account deletion requested');
    }
  };

  const handleCopyToken = () => {
    if (token) {
      navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
          Settings
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Manage your account and preferences
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Main settings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Account Settings */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Account Settings
                </CardTitle>
                <CardDescription>Manage your account information</CardDescription>
              </CardHeader>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Email
                  </label>
                  <Input
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="bg-slate-100 dark:bg-slate-800"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Contact support to change your email
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Name
                  </label>
                  <Input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    JWT Token (for Windows Collector)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={token || ''}
                      readOnly
                      className="flex-1 font-mono text-xs bg-slate-100 dark:bg-slate-800"
                      placeholder="No token available"
                    />
                    <Button
                      onClick={handleCopyToken}
                      disabled={!token}
                      variant="secondary"
                      size="md"
                      className="shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Copy this token and paste it in Windows Collector Settings
                  </p>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Change Password */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Change Password
                </CardTitle>
                <CardDescription>Update your password to keep your account secure</CardDescription>
              </CardHeader>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <Input
                  type="password"
                  label="Current Password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                />
                <Input
                  type="password"
                  label="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                />
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" size="md">
                    Update Password
                  </Button>
                </div>
              </form>
            </Card>
          </motion.div>

          {/* Devices */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Laptop className="w-5 h-5" />
                  Connected Devices
                </CardTitle>
                <CardDescription>Manage devices syncing your data</CardDescription>
              </CardHeader>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                      <Laptop className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        Windows Desktop
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Last sync: Just now
                      </p>
                    </div>
                  </div>
                  <Badge variant="success">Active</Badge>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <Laptop className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        MacBook Pro
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Last sync: 2 hours ago
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Connected</Badge>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Notifications */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Notifications
                </CardTitle>
                <CardDescription>Configure your notification preferences</CardDescription>
              </CardHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      Email Notifications
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Receive updates via email
                    </p>
                  </div>
                  <button
                    onClick={() => setEmailNotifications(!emailNotifications)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      emailNotifications ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        emailNotifications ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      Weekly Reports
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Get weekly activity summaries
                    </p>
                  </div>
                  <button
                    onClick={() => setWeeklyReport(!weeklyReport)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      weeklyReport ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        weeklyReport ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>

        {/* Right column - Quick actions */}
        <div className="space-y-6">
          {/* Appearance */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {darkMode ? (
                    <Moon className="w-5 h-5" />
                  ) : (
                    <Sun className="w-5 h-5" />
                  )}
                  Appearance
                </CardTitle>
                <CardDescription>Customize your experience</CardDescription>
              </CardHeader>
              <div className="space-y-3">
                <Button
                  variant={darkMode ? 'secondary' : 'primary'}
                  className="w-full justify-start"
                  onClick={toggleDarkMode}
                >
                  <Sun className="w-4 h-4 mr-2" />
                  Light Mode
                </Button>
                <Button
                  variant={darkMode ? 'primary' : 'secondary'}
                  className="w-full justify-start"
                  onClick={toggleDarkMode}
                >
                  <Moon className="w-4 h-4 mr-2" />
                  Dark Mode
                </Button>
              </div>
            </Card>
          </motion.div>

          {/* Data Management */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  Data
                </CardTitle>
                <CardDescription>Export or manage your data</CardDescription>
              </CardHeader>
              <div className="space-y-3">
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={handleDataExport}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export All Data
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  onClick={handleAccountDelete}
                >
                  Delete Account
                </Button>
              </div>
            </Card>
          </motion.div>

          {/* Privacy */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Privacy
                </CardTitle>
                <CardDescription>Your data is encrypted and secure</CardDescription>
              </CardHeader>
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <p>• All data encrypted at rest</p>
                <p>• TLS encryption in transit</p>
                <p>• No third-party data sharing</p>
                <p>• GDPR compliant</p>
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
