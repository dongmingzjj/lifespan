mod connection;

pub use connection::{Database, StoredEvent};

use crate::collector::window_tracker::WindowInfo;

impl Database {
  /// Async wrapper for store_event (blocking operation)
  pub async fn store_event(&self, window_info: &WindowInfo) -> anyhow::Result<()> {
    let db = self.clone();
    let window_info = window_info.clone();
    tokio::task::spawn_blocking(move || {
      db.store_event_sync(&window_info)
    })
    .await
    .map_err(|e| anyhow::anyhow!("Task join error: {}", e))?
  }

  /// Async wrapper for get_last_sync_time
  pub async fn get_last_sync_time(&self) -> anyhow::Result<Option<chrono::DateTime<chrono::Utc>>> {
    let db = self.clone();
    tokio::task::spawn_blocking(move || {
      db.get_last_sync_time_sync()
    })
    .await
    .map_err(|e| anyhow::anyhow!("Task join error: {}", e))?
  }
}
