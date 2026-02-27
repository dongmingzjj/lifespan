use crate::database::{Database, StoredEvent};
use crate::encryption::CryptoManager;
use anyhow::Result;
use base64::Engine;
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tracing::{info, error, debug};

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub server_url: String,
    pub jwt_token: String,
    pub device_id: String,
}

/// Sync status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub is_syncing: bool,
    pub last_sync_at: Option<String>,
    pub pending_events: i64,
    pub last_error: Option<String>,
}

/// Sync result from server
#[derive(Debug, Serialize, Deserialize)]
struct SyncResponse {
    synced: i32,
    failed: i32,
    sync_time: String,
}

/// Event to send to server
#[derive(Debug, Serialize)]
struct SyncEvent {
    id: String,                                // UUID
    event_type: String,
    timestamp: i64,
    duration: i32,
    encrypted_data: String,                    // Required
    nonce: String,                             // 12 bytes in hex (24 chars)
    tag: String,                               // 16 bytes base64 STANDARD with padding (24 chars)
    app_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    category: Option<String>,
}

/// Request body for sync API
#[derive(Debug, Serialize)]
struct SyncRequest {
    device_id: String,
    events: Vec<SyncEvent>,
}

/// Sync errors
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("Network error: {0}")]
    Network(String),

    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Server error: {0}")]
    Server(String),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

/// Sync result
pub type SyncResult = std::result::Result<(), SyncError>;

/// Sync client for uploading events to server
pub struct SyncClient {
    db: Arc<Database>,
    crypto: Arc<Mutex<Option<CryptoManager>>>,
    http_client: Client,
    config: Arc<Mutex<Option<ServerConfig>>>,
    is_syncing: Arc<Mutex<bool>>,
    auto_sync_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

/// Configuration for sync behavior
#[derive(Debug, Clone)]
pub struct SyncConfig {
    pub auto_sync_interval: Duration,
    pub auto_sync_batch_size: usize,
    pub auto_sync_enabled: bool,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            auto_sync_interval: Duration::from_secs(300), // 5 minutes
            auto_sync_batch_size: 100,
            auto_sync_enabled: true,
        }
    }
}

impl SyncClient {
    /// Create a new sync client
    pub fn new(db: Arc<Database>) -> Self {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            db,
            crypto: Arc::new(Mutex::new(None)),
            http_client,
            config: Arc::new(Mutex::new(None)),
            is_syncing: Arc::new(Mutex::new(false)),
            auto_sync_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Set encryption key
    pub async fn set_crypto_key(&self, key: [u8; 32]) -> Result<()> {
        let crypto = CryptoManager::new(&key)?;
        let mut crypto_guard = self.crypto.lock().await;
        *crypto_guard = Some(crypto);
        Ok(())
    }

    /// Set server configuration
    pub async fn set_config(&self, config: ServerConfig) -> Result<()> {
        // Store config in database first
        let config_json = serde_json::to_string(&config)?;
        self.db.set_setting("server_config", &config_json)?;

        // Update in-memory config
        let mut config_guard = self.config.lock().await;
        *config_guard = Some(config);

        Ok(())
    }

    /// Get server configuration
    pub async fn get_config(&self) -> Result<Option<ServerConfig>> {
        // Try to load from database first
        if let Some(config_json) = self.db.get_setting("server_config")? {
            if let Ok(config) = serde_json::from_str::<ServerConfig>(&config_json) {
                return Ok(Some(config));
            }
        }

        // Fallback to in-memory config
        let config_guard = self.config.lock().await;
        Ok(config_guard.clone())
    }

    /// Get current sync status
    pub async fn get_status(&self) -> Result<SyncStatus> {
        let is_syncing = *self.is_syncing.lock().await;
        let last_sync_at = self.db.get_last_sync_time().await?;

        // Get count of unsynced events using spawn_blocking for async safety
        let db = self.db.clone();
        let unsynced_events = tokio::task::spawn_blocking(move || {
            db.get_unsynced_events_sync()
        })
        .await
        .map_err(|e| anyhow::anyhow!("Task join error: {}", e))??;
        let pending_events = unsynced_events.len() as i64;

        // Get last error from database
        let last_error = self.db
            .get_setting("last_sync_error")
            .unwrap_or(None);

        Ok(SyncStatus {
            is_syncing,
            last_sync_at: last_sync_at.map(|t| t.to_rfc3339()),
            pending_events,
            last_error,
        })
    }

    /// Check if auto-sync is needed (based on pending event count)
    pub async fn check_and_sync_if_needed(&self, threshold: usize) -> Result<(), SyncError> {
        let db = self.db.clone();
        let unsynced_events = tokio::task::spawn_blocking(move || {
            db.get_unsynced_events_sync()
        })
        .await
        .map_err(|e| SyncError::Database(format!("Failed to check pending events: {}", e)))
        .and_then(|r| r.map_err(|e| SyncError::Database(format!("Failed to get events: {}", e))))?;
        let pending_count = unsynced_events.len();

        debug!("Pending events: {}, threshold: {}", pending_count, threshold);

        if pending_count >= threshold {
            info!("Auto-sync triggered: {} events pending", pending_count);
            self.sync_events().await?;
        }

        Ok(())
    }

    /// Start automatic sync scheduler
    pub async fn start_auto_sync(&self, config: SyncConfig) -> Result<()> {
        // Stop existing auto-sync if running
        self.stop_auto_sync().await;

        if !config.auto_sync_enabled {
            info!("Auto-sync is disabled");
            return Ok(());
        }

        let interval = config.auto_sync_interval;
        let batch_threshold = config.auto_sync_batch_size;
        let is_syncing = self.is_syncing.clone();
        let db = self.db.clone();

        info!("Starting auto-sync: interval={:?}, batch_threshold={}", interval, batch_threshold);

        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.tick().await; // Skip first immediate tick

            loop {
                ticker.tick().await;

                // Check if already syncing
                {
                    let syncing = is_syncing.lock().await;
                    if *syncing {
                        debug!("Auto-sync skipped: sync already in progress");
                        continue;
                    }
                }

                // Check pending count
                let db_clone = db.clone();
                let pending_count = match tokio::task::spawn_blocking(move || {
                    db_clone.get_unsynced_events_sync()
                })
                .await
                {
                    Ok(Ok(events)) => events.len(),
                    Ok(Err(e)) => {
                        error!("Failed to check pending events: {}", e);
                        continue;
                    }
                    Err(e) => {
                        error!("Task join error: {}", e);
                        continue;
                    }
                };

                if pending_count > 0 {
                    info!("Auto-sync: {} events pending", pending_count);
                    // Note: We can't call self.sync_events() here directly
                    // The caller should handle this via check_and_sync_if_needed
                }
            }
        });

        let mut sync_handle = self.auto_sync_handle.lock().await;
        *sync_handle = Some(handle);

        Ok(())
    }

    /// Stop automatic sync scheduler
    pub async fn stop_auto_sync(&self) {
        let mut handle_guard = self.auto_sync_handle.lock().await;
        if let Some(handle) = handle_guard.take() {
            handle.abort();
            info!("Auto-sync stopped");
        }
    }

    /// Sync events to server
    pub async fn sync_events(&self) -> SyncResult {
        let start_time = std::time::Instant::now();

        // Check if already syncing
        {
            let mut syncing = self.is_syncing.lock().await;
            if *syncing {
                return Err(SyncError::Unknown("Sync already in progress".to_string()));
            }
            *syncing = true;
        }

        // Ensure we reset syncing flag when done (even on error)
        let is_syncing = self.is_syncing.clone();
        let _guard = scopeguard::guard((), move |_| {
            // This will run when the guard is dropped
            tokio::spawn(async move {
                let mut syncing = is_syncing.lock().await;
                *syncing = false;
            });
        });

        // Get server configuration
        let config = self.get_config().await
            .map_err(|e| SyncError::Unknown(format!("Failed to get config: {}", e)))?
            .ok_or_else(|| SyncError::Unknown("Server not configured".to_string()))?;

        // Get unsynced events using spawn_blocking for async safety
        let db = self.db.clone();
        let events = tokio::task::spawn_blocking(move || {
            db.get_unsynced_events_sync()
        })
        .await
        .map_err(|e| SyncError::Database(format!("Task join error: {}", e)))
        .and_then(|r| r.map_err(|e| SyncError::Database(format!("Failed to get events: {}", e))))?;

        if events.is_empty() {
            info!("No events to sync");
            return Ok(());
        }

        // Take only first 100 events
        let batch: Vec<_> = events.into_iter().take(100).collect();
        let batch_size = batch.len();
        let event_ids: Vec<String> = batch.iter().map(|e| e.id.clone()).collect();

        info!("Syncing {} events to {}", batch_size, config.server_url);

        // Encrypt and send events with retry logic
        let result = self.sync_with_retry(&config, &batch, 3).await;

        match result {
            Ok(_) => {
                // Mark events as synced
                self.db.mark_as_synced(&event_ids)
                    .map_err(|e| SyncError::Database(format!("Failed to mark as synced: {}", e)))?;

                // Update last sync time
                let now = Utc::now().timestamp_millis().to_string();
                self.db.update_sync_state("last_sync_at", &now)
                    .map_err(|e| SyncError::Database(format!("Failed to update sync state: {}", e)))?;

                // Clear last error
                let _ = self.db.set_setting("last_sync_error", "");

                let elapsed = start_time.elapsed();
                info!("Sync completed: {} events in {:?}", batch_size, elapsed);

                Ok(())
            }
            Err(e) => {
                // Store error for UI display
                let error_msg = e.to_string();
                let _ = self.db.set_setting("last_sync_error", &error_msg);

                let elapsed = start_time.elapsed();
                error!("Sync failed after {:?}: {}", elapsed, error_msg);

                Err(e)
            }
        }
    }

    /// Sync with retry logic (exponential backoff)
    async fn sync_with_retry(&self, config: &ServerConfig, events: &[StoredEvent], max_retries: u32) -> SyncResult {
        let mut attempt = 0;
        let mut delay = Duration::from_secs(1);

        loop {
            attempt += 1;

            match self.send_events(config, events).await {
                Ok(_) => return Ok(()),
                Err(e) => {
                    if attempt >= max_retries {
                        return Err(e);
                    }

                    // Check if error is retryable
                    match &e {
                        SyncError::Auth(_) => {
                            // Don't retry auth errors
                            return Err(e);
                        }
                        SyncError::Network(_) | SyncError::Server(_) => {
                            // Retry with exponential backoff
                            tokio::time::sleep(delay).await;
                            delay = delay.saturating_mul(2);
                        }
                        _ => {
                            // Don't retry other errors
                            return Err(e);
                        }
                    }
                }
            }
        }
    }

    /// Send events to server
    async fn send_events(&self, config: &ServerConfig, events: &[StoredEvent]) -> SyncResult {
        // Build sync events with encryption
        let sync_events = self.build_sync_events(events).await?;

        // Build request
        let request = SyncRequest {
            device_id: config.device_id.clone(),
            events: sync_events,
        };

        // Send to server
        let url = format!("{}/api/v1/sync/events", config.server_url.trim_end_matches('/'));

        let response = self.http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.jwt_token))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| SyncError::Network(format!("Failed to connect: {}", e)))?;

        // Handle response
        let status = response.status();

        if status.is_success() {
            let sync_response: SyncResponse = response
                .json()
                .await
                .map_err(|e| SyncError::Unknown(format!("Failed to parse response: {}", e)))?;

            tracing::info!("Sync successful: {} events synced", sync_response.synced);
            Ok(())
        } else {
            match status.as_u16() {
                401 | 403 => {
                    let error_text = response.text().await.unwrap_or_default();
                    Err(SyncError::Auth(format!("Authentication failed: {}", error_text)))
                }
                500..=599 => {
                    let error_text = response.text().await.unwrap_or_default();
                    Err(SyncError::Server(format!("Server error: {}", error_text)))
                }
                _ => {
                    let error_text = response.text().await.unwrap_or_default();
                    Err(SyncError::Unknown(format!("HTTP {}: {}", status.as_u16(), error_text)))
                }
            }
        }
    }

    /// Build sync events with encryption
    async fn build_sync_events(&self, events: &[StoredEvent]) -> std::result::Result<Vec<SyncEvent>, SyncError> {
        let mut sync_events = Vec::with_capacity(events.len());
        let crypto = self.crypto.lock().await;

        let crypto_ref = crypto.as_ref()
            .ok_or_else(|| SyncError::Encryption("Crypto manager not initialized".to_string()))?;

        for event in events {
            // Use database event ID instead of generating new UUID
            let id = event.id.clone();

            // Prepare data to encrypt (use app_name or window_title)
            let plaintext = event.window_title.as_ref()
                .map(|s| s.as_bytes())
                .unwrap_or_else(|| event.app_name.as_bytes());

            // Encrypt data
            let encrypted = crypto_ref.encrypt(plaintext)
                .map_err(|e| SyncError::Encryption(format!("Failed to encrypt: {}", e)))?;

            // Extract nonce (12 bytes) and encode as hex (24 chars)
            let nonce = hex::encode(&encrypted.nonce);

            // Extract tag from ciphertext (last 16 bytes of AES-GCM)
            // Note: aes_gcm crate appends the tag to the ciphertext
            let tag_len = 16;
            let ciphertext_len = encrypted.ciphertext.len();
            if ciphertext_len < tag_len {
                return Err(SyncError::Encryption("Invalid ciphertext length".to_string()));
            }
            let tag_bytes = &encrypted.ciphertext[ciphertext_len - tag_len..];

            // Encode tag as base64 STANDARD with padding: 16 bytes -> 24 chars
            let tag = base64::engine::general_purpose::STANDARD.encode(tag_bytes);

            // Encode ciphertext WITHOUT the tag (just the encrypted payload)
            // The tag is sent separately for verification
            let payload_len = ciphertext_len - tag_len;
            let encrypted_data = base64::engine::general_purpose::STANDARD.encode(&encrypted.ciphertext[..payload_len]);

            // Determine category
            let category = self.categorize_app(&event.app_name);

            // Ensure timestamp is not in the future (max 1 minute ahead allowed)
            let now_millis = Utc::now().timestamp_millis();
            let event_timestamp = event.timestamp.timestamp_millis();
            let timestamp = if event_timestamp > now_millis + 60000 {
                // If event is more than 1 minute in the future, use current time
                now_millis
            } else {
                event_timestamp
            };

            let sync_event = SyncEvent {
                id,
                event_type: event.event_type.clone(),
                timestamp,
                duration: event.duration,
                encrypted_data,
                nonce,
                tag,
                app_name: event.app_name.clone(),
                category,
            };

            sync_events.push(sync_event);
        }

        debug!("Built {} sync events with encryption", sync_events.len());
        Ok(sync_events)
    }

    /// Categorize app based on name
    fn categorize_app(&self, app_name: &str) -> Option<String> {
        let app_lower = app_name.to_lowercase();

        let category = if app_lower.contains("chrome") || app_lower.contains("firefox") || app_lower.contains("edge") {
            "work"
        } else if app_lower.contains("code") || app_lower.contains("idea") || app_lower.contains("visual") {
            "development"
        } else if app_lower.contains("slack") || app_lower.contains("teams") || app_lower.contains("zoom") {
            "communication"
        } else if app_lower.contains("spotify") || app_lower.contains("netflix") || app_lower.contains("vlc") {
            "entertainment"
        } else if app_lower.contains("word") || app_lower.contains("excel") || app_lower.contains("powerpoint") {
            "productivity"
        } else if app_lower.contains("steam") || app_lower.contains("game") {
            "gaming"
        } else {
            "other"
        };

        Some(category.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use tempfile::NamedTempFile;

    fn create_test_db() -> (Database, NamedTempFile) {
        let temp_file = NamedTempFile::new().unwrap();
        let db = Database::new(temp_file.path()).unwrap();
        (db, temp_file)
    }

    #[test]
    fn test_server_config_serialization() {
        let config = ServerConfig {
            server_url: "https://api.example.com".to_string(),
            jwt_token: "test_token".to_string(),
            device_id: Uuid::new_v4().to_string(),
        };

        let json = serde_json::to_string(&config).unwrap();
        let config2: ServerConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(config.server_url, config2.server_url);
        assert_eq!(config.jwt_token, config2.jwt_token);
        assert_eq!(config.device_id, config2.device_id);
    }

    #[test]
    fn test_sync_status_serialization() {
        let status = SyncStatus {
            is_syncing: true,
            last_sync_at: Some("2024-01-01T00:00:00Z".to_string()),
            pending_events: 100,
            last_error: Some("Network error".to_string()),
        };

        let json = serde_json::to_string(&status).unwrap();
        let status2: SyncStatus = serde_json::from_str(&json).unwrap();

        assert_eq!(status.is_syncing, status2.is_syncing);
        assert_eq!(status.pending_events, status2.pending_events);
    }

    #[test]
    fn test_sync_request_serialization() {
        let request = SyncRequest {
            device_id: Uuid::new_v4().to_string(),
            events: vec![
                SyncEvent {
                    id: Uuid::new_v4().to_string(),
                    event_type: "app_usage".to_string(),
                    timestamp: 1234567890,
                    duration: 300,
                    encrypted_data: "encrypted_base64_data".to_string(),
                    nonce: "00112233445566778899aa".to_string(), // 12 bytes hex
                    tag: "tag_base64".to_string(),
                    app_name: "Chrome".to_string(),
                    category: Some("work".to_string()),
                }
            ],
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("app_usage"));
        assert!(json.contains("Chrome"));
    }

    #[test]
    fn test_sync_response_deserialization() {
        let json = r#"{"synced":100,"failed":0,"sync_time":"2024-01-01T00:00:00Z"}"#;
        let response: SyncResponse = serde_json::from_str(json).unwrap();

        assert_eq!(response.synced, 100);
        assert_eq!(response.failed, 0);
    }

    #[test]
    fn test_app_categorization() {
        let temp_file = NamedTempFile::new().unwrap();
        let db = Database::new(temp_file.path()).unwrap();
        let client = SyncClient::new(std::sync::Arc::new(db));

        assert_eq!(client.categorize_app("chrome.exe"), Some("work".to_string()));
        assert_eq!(client.categorize_app("code.exe"), Some("development".to_string()));
        assert_eq!(client.categorize_app("slack.exe"), Some("communication".to_string()));
        assert_eq!(client.categorize_app("spotify.exe"), Some("entertainment".to_string()));
        assert_eq!(client.categorize_app("word.exe"), Some("productivity".to_string()));
        assert_eq!(client.categorize_app("steam.exe"), Some("gaming".to_string()));
        assert_eq!(client.categorize_app("unknown.exe"), Some("other".to_string()));
    }

    #[test]
    fn test_sync_error_display() {
        let err = SyncError::Network("Connection timeout".to_string());
        assert_eq!(err.to_string(), "Network error: Connection timeout");

        let err = SyncError::Auth("Invalid token".to_string());
        assert_eq!(err.to_string(), "Authentication failed: Invalid token");

        let err = SyncError::Server("Internal error".to_string());
        assert_eq!(err.to_string(), "Server error: Internal error");
    }
}
