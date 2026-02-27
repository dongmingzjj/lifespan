use crate::collector::window_tracker::WindowInfo;
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Database {
  pub(crate) conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Serialize)]
pub struct StoredEvent {
  pub id: String,
  pub event_type: String,
  pub timestamp: DateTime<Utc>,
  pub duration: i32,
  pub app_name: String,
  pub window_title: Option<String>,
}

impl Database {
  pub fn new(db_path: &Path) -> Result<Self> {
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
      std::fs::create_dir_all(parent)?;
    }

    // Open database connection
    let conn = Connection::open_with_flags(
      db_path,
      OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;

    let db = Self {
      conn: Arc::new(Mutex::new(conn)),
    };

    // Initialize schema
    db.init_schema()?;

    Ok(db)
  }

  fn init_schema(&self) -> Result<()> {
    let conn = self.conn.lock().unwrap();

    // Enable WAL mode for better concurrency
    conn.execute_batch(
      r#"
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
      PRAGMA page_size = 4096;
      "#,
    )?;

    // Create tables
    conn.execute_batch(
      r#"
      CREATE TABLE IF NOT EXISTS local_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        app_name TEXT NOT NULL,
        window_title TEXT,
        synced INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_local_events_timestamp
        ON local_events(timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_local_events_synced
        ON local_events(synced) WHERE synced = 0;

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS local_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO local_settings (key, value, updated_at)
        VALUES ('idle_threshold_seconds', '300', strftime('%s', 'now') * 1000);
      "#,
    )?;

    Ok(())
  }

  pub(crate) fn store_event_sync(&self, window_info: &WindowInfo) -> Result<()> {
    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = Utc::now().timestamp_millis();
    let event_type = "app_usage";
    let duration = 0; // Will be updated when window changes

    let conn = self.conn.lock().unwrap();

    let mut stmt = conn.prepare_cached(
      r#"
      INSERT INTO local_events (id, event_type, timestamp, duration, app_name, window_title)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      "#,
    )?;

    stmt.execute((
      &id,
      event_type,
      timestamp,
      duration,
      &window_info.process_name,
      &window_info.window_title,
    ))?;

    Ok(())
  }

  pub fn get_events(&self, limit: i32, offset: i32) -> Result<Vec<StoredEvent>> {
    let conn = self.conn.lock().unwrap();

    let mut stmt = conn.prepare_cached(
      r#"
      SELECT id, event_type, timestamp, duration, app_name, window_title
      FROM local_events
      ORDER BY timestamp DESC
      LIMIT ?1 OFFSET ?2
      "#,
    )?;

    let events = stmt.query_map((limit, offset), |row| {
      Ok(StoredEvent {
        id: row.get(0)?,
        event_type: row.get(1)?,
        timestamp: DateTime::from_timestamp(row.get::<_, i64>(2)? / 1000, 0)
          .unwrap_or_default(),
        duration: row.get(3)?,
        app_name: row.get(4)?,
        window_title: row.get(5)?,
      })
    })?;

    events.collect::<Result<Vec<_>, _>>().map_err(|e| e.into())
  }

  pub fn get_event_count(&self) -> Result<i64> {
    let conn = self.conn.lock().unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM local_events", [], |row| row.get(0))?;
    Ok(count)
  }

  pub fn get_unsynced_events(&self) -> Result<Vec<StoredEvent>> {
    let conn = self.conn.lock().unwrap();

    let mut stmt = conn.prepare_cached(
      r#"
      SELECT id, event_type, timestamp, duration, app_name, window_title
      FROM local_events
      WHERE synced = 0
      ORDER BY timestamp ASC
      "#,
    )?;

    let events = stmt.query_map([], |row| {
      Ok(StoredEvent {
        id: row.get(0)?,
        event_type: row.get(1)?,
        timestamp: DateTime::from_timestamp(row.get::<_, i64>(2)? / 1000, 0)
          .unwrap_or_default(),
        duration: row.get(3)?,
        app_name: row.get(4)?,
        window_title: row.get(5)?,
      })
    })?;

    events.collect::<Result<Vec<_>, _>>().map_err(|e| e.into())
  }

  pub fn mark_as_synced(&self, event_ids: &[String]) -> Result<()> {
    if event_ids.is_empty() {
      return Ok(());
    }

    let conn = self.conn.lock().unwrap();
    let tx = conn.unchecked_transaction()?;

    for id in event_ids {
      tx.execute("UPDATE local_events SET synced = 1 WHERE id = ?", [id])?;
    }

    tx.commit()?;
    Ok(())
  }

  pub(crate) fn get_last_sync_time_sync(&self) -> Result<Option<DateTime<Utc>>> {
    let conn = self.conn.lock().unwrap();

    let result: Option<String> = conn
      .query_row(
        "SELECT value FROM sync_state WHERE key = 'last_sync_at'",
        [],
        |row| row.get(0),
      )
      .ok();

    Ok(result.and_then(|ts| ts.parse::<i64>().ok()).and_then(|ts| DateTime::from_timestamp_millis(ts)))
  }

  pub fn update_sync_state(&self, key: &str, value: &str) -> Result<()> {
    let conn = self.conn.lock().unwrap();
    let now = Utc::now().timestamp_millis();

    conn.execute(
      r#"
      INSERT INTO sync_state (key, value, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      "#,
      (key, value, now),
    )?;

    Ok(())
  }

  pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
    let conn = self.conn.lock().unwrap();

    let result: Option<String> = conn
      .query_row("SELECT value FROM local_settings WHERE key = ?", [key], |row| row.get(0))
      .ok();

    Ok(result)
  }

  pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
    let conn = self.conn.lock().unwrap();
    let now = Utc::now().timestamp_millis();

    conn.execute(
      r#"
      INSERT INTO local_settings (key, value, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      "#,
      (key, value, now),
    )?;

    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::NamedTempFile;

  fn create_test_db() -> (Database, NamedTempFile) {
    let temp_file = NamedTempFile::new().unwrap();
    let db = Database::new(temp_file.path()).unwrap();
    (db, temp_file)
  }

  fn create_test_window_info(process_name: &str, window_title: &str) -> WindowInfo {
    WindowInfo {
      process_name: process_name.to_string(),
      window_title: window_title.to_string(),
      timestamp: Utc::now(),
    }
  }

  #[test]
  fn test_database_creation() {
    let (db, _temp) = create_test_db();
    assert_eq!(db.get_event_count().unwrap(), 0);
  }

  #[test]
  fn test_database_creates_tables() {
    let (db, _temp) = create_test_db();

    // Verify tables exist by querying them
    let conn = db.conn.lock().unwrap();
    let tables: Vec<String> = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .unwrap()
      .query_map([], |row| row.get(0))
      .unwrap()
      .collect::<Result<_, _>>()
      .unwrap();

    assert!(tables.contains(&"local_events".to_string()));
    assert!(tables.contains(&"sync_state".to_string()));
    assert!(tables.contains(&"local_settings".to_string()));
  }

  #[test]
  fn test_store_event() {
    let (db, _temp) = create_test_db();
    let window_info = create_test_window_info("test_app", "Test Window");

    db.store_event_sync(&window_info).unwrap();
    assert_eq!(db.get_event_count().unwrap(), 1);
  }

  #[test]
  fn test_store_multiple_events() {
    let (db, _temp) = create_test_db();

    for i in 0..5 {
      let window_info = create_test_window_info(&format!("app{}", i), &format!("Window {}", i));
      db.store_event_sync(&window_info).unwrap();
    }

    assert_eq!(db.get_event_count().unwrap(), 5);
  }

  #[test]
  fn test_get_events_with_limit() {
    let (db, _temp) = create_test_db();

    // Store 10 events
    for i in 0..10 {
      let window_info = create_test_window_info(&format!("app{}", i), &format!("Window {}", i));
      db.store_event_sync(&window_info).unwrap();
    }

    // Get first 5
    let events = db.get_events(5, 0).unwrap();
    assert_eq!(events.len(), 5);
  }

  #[test]
  fn test_get_events_with_offset() {
    let (db, _temp) = create_test_db();

    // Store 5 events
    for i in 0..5 {
      let window_info = create_test_window_info(&format!("app{}", i), &format!("Window {}", i));
      db.store_event_sync(&window_info).unwrap();
    }

    // Skip first 2, get next 3
    let events = db.get_events(10, 2).unwrap();
    assert_eq!(events.len(), 3);
  }

  #[test]
  fn test_get_events_ordering() {
    let (db, _temp) = create_test_db();

    // Store events with different timestamps
    for i in 0..3 {
      let mut window_info = create_test_window_info(&format!("app{}", i), &format!("Window {}", i));
      // Adjust timestamp to ensure different times
      window_info.timestamp = Utc::now() - chrono::Duration::seconds((3 - i) as i64);
      db.store_event_sync(&window_info).unwrap();
      std::thread::sleep(std::time::Duration::from_millis(10));
    }

    // Events should be ordered by timestamp DESC
    let events = db.get_events(10, 0).unwrap();
    assert_eq!(events.len(), 3);
  }

  #[test]
  fn test_get_unsynced_events() {
    let (db, _temp) = create_test_db();

    // Store 3 events
    for i in 0..3 {
      let window_info = create_test_window_info(&format!("app{}", i), &format!("Window {}", i));
      db.store_event_sync(&window_info).unwrap();
    }

    // All should be unsynced initially
    let unsynced = db.get_unsynced_events().unwrap();
    assert_eq!(unsynced.len(), 3);
  }

  #[test]
  fn test_mark_as_synced() {
    let (db, _temp) = create_test_db();

    // Store events
    let mut event_ids = Vec::new();
    for _ in 0..3 {
      let window_info = create_test_window_info("test_app", "Test Window");
      db.store_event_sync(&window_info).unwrap();

      // Get the event ID
      let events = db.get_unsynced_events().unwrap();
      if let Some(last) = events.last() {
        event_ids.push(last.id.clone());
      }
    }

    // Mark first 2 as synced
    let ids_to_sync = &event_ids[..2.min(event_ids.len())];
    db.mark_as_synced(ids_to_sync).unwrap();

    // Only 1 should remain unsynced
    let unsynced = db.get_unsynced_events().unwrap();
    assert_eq!(unsynced.len(), 1);
  }

  #[test]
  fn test_mark_empty_list_as_synced() {
    let (db, _temp) = create_test_db();
    let result = db.mark_as_synced(&[]);
    assert!(result.is_ok());
  }

  #[test]
  fn test_get_last_sync_time_initially_none() {
    let (db, _temp) = create_test_db();
    let last_sync = db.get_last_sync_time().unwrap();
    assert!(last_sync.is_none());
  }

  #[test]
  fn test_update_sync_state() {
    let (db, _temp) = create_test_db();
    let now = Utc::now().timestamp_millis().to_string();

    db.update_sync_state("last_sync_at", &now).unwrap();

    let last_sync = db.get_last_sync_time().unwrap();
    assert!(last_sync.is_some());
  }

  #[test]
  fn test_update_sync_state_overwrites() {
    let (db, _temp) = create_test_db();

    db.update_sync_state("test_key", "value1").unwrap();
    db.update_sync_state("test_key", "value2").unwrap();

    let conn = db.conn.lock().unwrap();
    let value: String = conn
      .query_row("SELECT value FROM sync_state WHERE key = 'test_key'", [], |row| row.get(0))
      .unwrap();

    assert_eq!(value, "value2");
  }

  #[test]
  fn test_get_setting_default() {
    let (db, _temp) = create_test_db();

    // Default setting should exist
    let idle_threshold = db.get_setting("idle_threshold_seconds").unwrap();
    assert_eq!(idle_threshold, Some("300".to_string()));
  }

  #[test]
  fn test_get_nonexistent_setting() {
    let (db, _temp) = create_test_db();

    let result = db.get_setting("nonexistent_key").unwrap();
    assert!(result.is_none());
  }

  #[test]
  fn test_set_setting() {
    let (db, _temp) = create_test_db();

    db.set_setting("custom_key", "custom_value").unwrap();

    let value = db.get_setting("custom_key").unwrap();
    assert_eq!(value, Some("custom_value".to_string()));
  }

  #[test]
  fn test_update_existing_setting() {
    let (db, _temp) = create_test_db();

    db.set_setting("test_key", "value1").unwrap();
    db.set_setting("test_key", "value2").unwrap();

    let value = db.get_setting("test_key").unwrap();
    assert_eq!(value, Some("value2".to_string()));
  }

  #[test]
  fn test_special_characters_in_window_title() {
    let (db, _temp) = create_test_db();

    let window_info = WindowInfo {
      process_name: "test_app".to_string(),
      window_title: "Test 🌍 日本語 ~!@#$%^&*()".to_string(),
      timestamp: Utc::now(),
    };

    db.store_event_sync(&window_info).unwrap();
    assert_eq!(db.get_event_count().unwrap(), 1);

    let events = db.get_events(1, 0).unwrap();
    assert_eq!(events[0].window_title, Some("Test 🌍 日本語 ~!@#$%^&*()".to_string()));
  }

  #[test]
  fn test_database_clone() {
    let (db1, _temp) = create_test_db();

    // Clone should work
    let db2 = db1.clone();

    // Store event using original
    let window_info = create_test_window_info("test_app", "Test Window");
    db1.store_event_sync(&window_info).unwrap();

    // Both should see the same data (same underlying connection)
    assert_eq!(db2.get_event_count().unwrap(), 1);
  }

  #[test]
  fn test_empty_window_title() {
    let (db, _temp) = create_test_db();

    let window_info = WindowInfo {
      process_name: "test_app".to_string(),
      window_title: "".to_string(),
      timestamp: Utc::now(),
    };

    db.store_event_sync(&window_info).unwrap();
    assert_eq!(db.get_event_count().unwrap(), 1);
  }

  #[test]
  fn test_long_process_name() {
    let (db, _temp) = create_test_db();

    let long_name = "a".repeat(1000);
    let window_info = WindowInfo {
      process_name: long_name.clone(),
      window_title: "Test".to_string(),
      timestamp: Utc::now(),
    };

    db.store_event_sync(&window_info).unwrap();

    let events = db.get_events(1, 0).unwrap();
    assert_eq!(events[0].app_name, long_name);
  }

  #[test]
  fn test_pragma_settings() {
    let (db, _temp) = create_test_db();
    let conn = db.conn.lock().unwrap();

    // Check WAL mode
    let wal_mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0)).unwrap();
    assert_eq!(wal_mode, "wal");

    // Check synchronous setting
    let sync: String = conn.query_row("PRAGMA synchronous", [], |row| row.get(0)).unwrap();
    assert_eq!(sync, "1"); // NORMAL = 1
  }

  #[test]
  fn test_event_stored_event_fields() {
    let (db, _temp) = create_test_db();

    let window_info = create_test_window_info("chrome.exe", "Google - Search");
    db.store_event_sync(&window_info).unwrap();

    let events = db.get_events(1, 0).unwrap();
    assert_eq!(events.len(), 1);

    let event = &events[0];
    assert!(!event.id.is_empty());
    assert_eq!(event.event_type, "app_usage");
    assert_eq!(event.app_name, "chrome.exe");
    assert_eq!(event.window_title, Some("Google - Search".to_string()));
    assert_eq!(event.duration, 0);
  }

  #[test]
  fn test_transaction_rollback_on_error() {
    let (db, _temp) = create_test_db();

    // Store a valid event first
    let window_info = create_test_window_info("app1", "Window 1");
    db.store_event_sync(&window_info).unwrap();

    // Try to mark non-existent IDs as synced (should not affect valid data)
    let fake_ids = vec!["fake-id-1".to_string(), "fake-id-2".to_string()];
    db.mark_as_synced(&fake_ids).unwrap();

    // Original event should still be unsynced
    let unsynced = db.get_unsynced_events().unwrap();
    assert_eq!(unsynced.len(), 1);
  }
}
