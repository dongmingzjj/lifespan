import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface CollectorStatus {
  is_running: boolean;
  events_collected: number;
  last_sync_at: string | null;
  active_window: string | null;
}

interface SyncStatus {
  is_syncing: boolean;
  last_sync_at: string | null;
  pending_events: number;
  last_error: string | null;
}

interface ServerConfig {
  server_url: string;
  jwt_token: string;
  device_id: string;
}

function App() {
  const [status, setStatus] = useState<CollectorStatus>({
    is_running: false,
    events_collected: 0,
    last_sync_at: null,
    active_window: null,
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    is_syncing: false,
    last_sync_at: null,
    pending_events: 0,
    last_error: null,
  });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig>({
    server_url: "http://localhost:3000",
    jwt_token: "",
    device_id: "",
  });

  // Load saved config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const savedConfig = await invoke<ServerConfig>("get_server_config");
        if (savedConfig) {
          setServerConfig(savedConfig);
        }
      } catch (error) {
        console.error("Failed to load config:", error);
        // Use defaults if no config saved
      }
    };
    loadConfig();
  }, []);

  // Fetch collector status
  const fetchStatus = async () => {
    try {
      const result = await invoke<CollectorStatus>("get_status");
      setStatus(result);
    } catch (error) {
      console.error("Failed to fetch status:", error);
    }
  };

  // Fetch sync status
  const fetchSyncStatus = async () => {
    try {
      const result = await invoke<SyncStatus>("get_sync_status");
      setSyncStatus(result);
    } catch (error) {
      console.error("Failed to fetch sync status:", error);
    }
  };

  // Start tracking
  const startTracking = async () => {
    setLoading(true);
    try {
      await invoke("start_tracking");
      await fetchStatus();
    } catch (error) {
      console.error("Failed to start tracking:", error);
    } finally {
      setLoading(false);
    }
  };

  // Stop tracking
  const stopTracking = async () => {
    setLoading(true);
    try {
      await invoke("stop_tracking");
      await fetchStatus();
    } catch (error) {
      console.error("Failed to stop tracking:", error);
    } finally {
      setLoading(false);
    }
  };

  // Sync now
  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await invoke<SyncStatus>("sync_now");
      setSyncStatus(result);
    } catch (error) {
      console.error("Failed to sync:", error);
      setSyncStatus({
        ...syncStatus,
        last_error: String(error),
      });
    } finally {
      setSyncing(false);
    }
  };

  // Save server config
  const saveConfig = async () => {
    try {
      // Generate device_id if empty
      let configToSave = { ...serverConfig };
      if (!configToSave.device_id || configToSave.device_id.trim() === "") {
        // Generate UUID v4
        configToSave.device_id = crypto.randomUUID();
      }

      await invoke("set_server_config", { config: configToSave });
      setShowSettings(false);
      await fetchSyncStatus();
    } catch (error) {
      console.error("Failed to save config:", error);
    }
  };

  // Poll status every second when running
  useEffect(() => {
    const interval = setInterval(() => {
      if (status.is_running) {
        fetchStatus();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [status.is_running]);

  // Poll sync status every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSyncStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Initial status fetch
  useEffect(() => {
    fetchStatus();
    fetchSyncStatus();
  }, []);

  return (
    <div className="container">
      <h1>Lifespan Desktop Collector</h1>

      <div className="status-card">
        <h2>Collector Status</h2>

        <div className="status-row">
          <span className="status-label">State:</span>
          <span className={`status-value ${status.is_running ? "running" : "stopped"}`}>
            {status.is_running ? "Running" : "Stopped"}
          </span>
        </div>

        <div className="status-row">
          <span className="status-label">Events Collected:</span>
          <span className="status-value">{status.events_collected}</span>
        </div>

        <div className="status-row">
          <span className="status-label">Active Window:</span>
          <span className="status-value">{status.active_window || "None"}</span>
        </div>
      </div>

      <div className="status-card">
        <h2>Sync Status</h2>

        <div className="status-row">
          <span className="status-label">Status:</span>
          <span className={`status-value ${
            syncStatus.is_syncing ? "syncing" :
            syncStatus.last_error ? "error" : "synced"
          }`}>
            {syncStatus.is_syncing ? "Syncing..." :
             syncStatus.last_error ? "Failed" :
             syncStatus.last_sync_at ? "Synced" : "Not synced"}
          </span>
        </div>

        <div className="status-row">
          <span className="status-label">Pending Events:</span>
          <span className="status-value">{syncStatus.pending_events}</span>
        </div>

        {syncStatus.last_sync_at && (
          <div className="status-row">
            <span className="status-label">Last Sync:</span>
            <span className="status-value">{new Date(syncStatus.last_sync_at).toLocaleString()}</span>
          </div>
        )}

        {syncStatus.last_error && (
          <div className="status-row">
            <span className="status-label">Last Error:</span>
            <span className="status-value error">{syncStatus.last_error}</span>
          </div>
        )}
      </div>

      <div className="controls">
        {status.is_running ? (
          <button
            onClick={stopTracking}
            disabled={loading}
            className="button button-stop"
          >
            {loading ? "Stopping..." : "Stop Tracking"}
          </button>
        ) : (
          <button
            onClick={startTracking}
            disabled={loading}
            className="button button-start"
          >
            {loading ? "Starting..." : "Start Tracking"}
          </button>
        )}

        <button
          onClick={syncNow}
          disabled={syncing || syncStatus.pending_events === 0}
          className="button button-sync"
        >
          {syncing ? "Syncing..." : "Sync Now"}
        </button>

        <button
          onClick={() => setShowSettings(!showSettings)}
          className="button button-settings"
        >
          Settings
        </button>
      </div>

      {showSettings && (
        <div className="settings-card">
          <h2>Server Configuration</h2>
          <p className="text-sm text-gray-600 mb-4">
            Get your JWT token from the Web Dashboard (Settings → Copy Token)
          </p>
          <div className="form-group">
            <label>Server URL:</label>
            <input
              type="text"
              value={serverConfig.server_url}
              onChange={(e) => setServerConfig({ ...serverConfig, server_url: e.target.value })}
              className="input"
              placeholder="http://localhost:3000"
            />
          </div>
          <div className="form-group">
            <label>JWT Token (required):</label>
            <input
              type="password"
              value={serverConfig.jwt_token}
              onChange={(e) => setServerConfig({ ...serverConfig, jwt_token: e.target.value })}
              className="input"
              placeholder="Paste your token from Web Dashboard Settings"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Log in to Web Dashboard → Settings → Copy JWT Token
            </p>
          </div>
          <div className="form-group">
            <label>Device ID:</label>
            <input
              type="text"
              value={serverConfig.device_id}
              onChange={(e) => setServerConfig({ ...serverConfig, device_id: e.target.value })}
              className="input"
              placeholder="Auto-generated if empty"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to auto-generate
            </p>
          </div>
          <div className="form-actions">
            <button onClick={saveConfig} className="button button-primary">
              Save Configuration
            </button>
            <button onClick={() => setShowSettings(false)} className="button button-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="info">
        <p>
          <strong>Privacy:</strong> All data is encrypted locally before sync.
          Window titles are sanitized for sensitive applications.
        </p>
        <p>
          <strong>Performance:</strong> Designed for &lt;1% CPU usage and &lt;50MB memory.
        </p>
        <p>
          <strong>Sync:</strong> Events are automatically synced every 5 minutes or when 100+ events are pending.
        </p>
      </div>
    </div>
  );
}

export default App;
