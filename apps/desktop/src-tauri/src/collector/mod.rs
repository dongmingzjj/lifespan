pub mod event_queue;
pub mod idle_detector;
pub mod window_tracker;

use crate::database::Database;
use anyhow::Result;
use event_queue::EventQueue;
use idle_detector::IdleDetector;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tracing::{info, debug, error};
use window_tracker::WindowTracker;

#[derive(Debug, Serialize)]
pub struct CollectorStatus {
  pub is_running: bool,
  pub events_collected: i64,
  pub last_sync_at: Option<String>,
  pub active_window: Option<String>,
}

pub struct Collector {
  db: Arc<Database>,
  window_tracker: WindowTracker,
  idle_detector: IdleDetector,
  event_queue: EventQueue,
  is_running: Arc<Mutex<bool>>,
  events_collected: Arc<Mutex<i64>>,
  active_window: Arc<Mutex<Option<String>>>,
}

impl Collector {
  pub fn new(db: Arc<Database>) -> Result<Self> {
    Ok(Self {
      db,
      window_tracker: WindowTracker::new()?,
      idle_detector: IdleDetector::new()?,
      event_queue: EventQueue::new(10_000),
      is_running: Arc::new(Mutex::new(false)),
      events_collected: Arc::new(Mutex::new(0)),
      active_window: Arc::new(Mutex::new(None)),
    })
  }

  pub async fn start(&self) -> Result<()> {
    let mut is_running = self.is_running.lock().await;
    if *is_running {
      return Ok(());
    }
    *is_running = true;
    drop(is_running);

    // Spawn tracking task
    let db = self.db.clone();
    let window_tracker = self.window_tracker.clone();
    let idle_detector = self.idle_detector.clone();
    let is_running = self.is_running.clone();
    let events_collected = self.events_collected.clone();
    let active_window = self.active_window.clone();

    info!("Collector tracking loop started");

    tokio::spawn(async move {
      let mut last_window: Option<String> = None;

      loop {
        // Check if still running
        {
          let running = is_running.lock().await;
          if !*running {
            info!("Collector stopping - is_running flag is false");
            break;
          }
        }

        // Check if idle
        let should_wait = match idle_detector.is_idle(Duration::from_secs(300)) {
          Ok(is_idle) => {
            if is_idle {
              debug!("User is idle, waiting 5 seconds...");
              // User is idle, wait and check again
              tokio::time::sleep(Duration::from_secs(5)).await;
              true
            } else {
              false
            }
          }
          Err(e) => {
            error!("Idle detector error: {}", e);
            false
          }
        };

        if should_wait {
          continue;
        }

        // Get active window
        let window_result = window_tracker.get_active_window_info();
        match window_result {
          Ok(window_info) => {
            let current_window = Some(window_info.process_name.clone());

            debug!("Current window: {:?}, Last window: {:?}", current_window, last_window);

            // Check if window changed
            if last_window != current_window {
              // ALWAYS increment counter on window change (including first window)
              let mut count = events_collected.lock().await;
              *count += 1;
              let current_count = *count;
              drop(count);

              // Log the window change
              if let Some(prev) = &last_window {
                info!("Window changed: '{}' -> '{}', total events: {}", prev, window_info.process_name, current_count);
              } else {
                info!("First window detected: '{}', total events: {}", window_info.process_name, current_count);
              }

              last_window = current_window.clone();

              // Update active window
              let mut active = active_window.lock().await;
              *active = Some(format!(
                "{} - {}",
                window_info.process_name,
                window_info.window_title
              ));

              // Store event in database
              debug!("Storing event in database...");
              if let Err(e) = db.store_event(&window_info).await {
                error!("Failed to store event: {}", e);
              } else {
                debug!("Event stored successfully");
              }
            } else {
              debug!("Window unchanged: {:?}", current_window);
            }
          }
          Err(e) => {
            error!("Window tracker error: {}", e);
          }
        }

        // Wait before next poll
        tokio::time::sleep(Duration::from_secs(1)).await;
      }

      info!("Collector tracking loop ended");
    });

    Ok(())
  }

  pub async fn stop(&self) -> Result<()> {
    info!("Collector stop requested");
    let mut is_running = self.is_running.lock().await;
    *is_running = false;

    // Clear active window
    let mut active = self.active_window.lock().await;
    *active = None;

    info!("Collector stop completed");
    Ok(())
  }

  pub async fn get_status(&self) -> Result<CollectorStatus> {
    let is_running = *self.is_running.lock().await;
    let events_collected = *self.events_collected.lock().await;
    let active_window = self.active_window.lock().await.clone();
    let last_sync_at = self.db.get_last_sync_time().await?.map(|t| t.to_rfc3339());

    Ok(CollectorStatus {
      is_running,
      events_collected,
      last_sync_at,
      active_window,
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Duration;

  #[test]
  fn test_collector_status_serialization() {
    let status = CollectorStatus {
      is_running: true,
      events_collected: 100,
      last_sync_at: Some("2024-01-01T00:00:00Z".to_string()),
      active_window: Some("chrome.exe - Google Search".to_string()),
    };

    let serialized = serde_json::to_string(&status);
    assert!(serialized.is_ok());

    let deserialized: Result<CollectorStatus, _> = serde_json::from_str(&serialized.unwrap());
    assert!(deserialized.is_ok());
    let status2 = deserialized.unwrap();
    assert_eq!(status2.is_running, true);
    assert_eq!(status2.events_collected, 100);
  }

  #[test]
  fn test_collector_status_with_none_values() {
    let status = CollectorStatus {
      is_running: false,
      events_collected: 0,
      last_sync_at: None,
      active_window: None,
    };

    let serialized = serde_json::to_string(&status).unwrap();
    let status2: CollectorStatus = serde_json::from_str(&serialized).unwrap();

    assert_eq!(status2.is_running, false);
    assert_eq!(status2.events_collected, 0);
    assert!(status2.last_sync_at.is_none());
    assert!(status2.active_window.is_none());
  }

  #[tokio::test]
  async fn test_collector_stop_when_not_running() {
    // Create a temporary database
    let temp_file = tempfile::NamedTempFile::new().unwrap();
    let db = Arc::new(Database::new(temp_file.path()).unwrap());

    let collector = Collector::new(db).unwrap();
    let result = collector.stop().await;

    assert!(result.is_ok());
  }

  #[tokio::test]
  async fn test_collector_get_status_initial() {
    let temp_file = tempfile::NamedTempFile::new().unwrap();
    let db = Arc::new(Database::new(temp_file.path()).unwrap());

    let collector = Collector::new(db).unwrap();
    let status = collector.get_status().await.unwrap();

    assert!(!status.is_running);
    assert_eq!(status.events_collected, 0);
    assert!(status.last_sync_at.is_none());
    assert!(status.active_window.is_none());
  }

  #[tokio::test]
  async fn test_collector_get_status_after_stop() {
    let temp_file = tempfile::NamedTempFile::new().unwrap();
    let db = Arc::new(Database::new(temp_file.path()).unwrap());

    let collector = Collector::new(db).unwrap();

    // Start and immediately stop
    collector.start().await.unwrap();
    collector.stop().await.unwrap();

    let status = collector.get_status().await.unwrap();
    assert!(!status.is_running);
    assert!(status.active_window.is_none());
  }

  #[test]
  fn test_window_tracker_new() {
    let tracker = WindowTracker::new();
    assert!(tracker.is_ok());
  }

  #[test]
  fn test_idle_detector_new() {
    let detector = IdleDetector::new();
    assert!(detector.is_ok());
  }

  #[test]
  fn test_event_queue_new() {
    let queue = EventQueue::new(100);
    assert_eq!(queue.max_size, 100);
  }

  #[tokio::test]
  async fn test_event_queue_enqueue_and_drain() {
    let queue = EventQueue::new(10);

    let window_info = crate::collector::window_tracker::WindowInfo {
      process_name: "test_app".to_string(),
      window_title: "Test Window".to_string(),
      timestamp: chrono::Utc::now(),
    };

    queue.enqueue(window_info).await.unwrap();
    assert_eq!(queue.len().await, 1);

    let events = queue.drain();
    assert_eq!(events.len(), 1);
    assert!(queue.is_empty().await);
  }

  #[tokio::test]
  async fn test_event_queue_empty_operations() {
    let queue = EventQueue::new(10);

    assert!(queue.is_empty().await);
    assert_eq!(queue.len().await, 0);

    let events = queue.drain();
    assert_eq!(events.len(), 0);
  }

  #[tokio::test]
  async fn test_idle_detector_zero_threshold() {
    let detector = IdleDetector::new().unwrap();

    // With zero threshold, should always report not idle immediately
    let result = detector.is_idle(Duration::from_secs(0));
    assert!(result.is_ok());
  }

  #[cfg(not(windows))]
  #[test]
  fn test_idle_detector_non_windows() {
    let detector = IdleDetector::new().unwrap();
    let result = detector.is_idle(Duration::from_secs(300));
    assert!(result.is_ok());
    // On non-Windows, should return false (not idle)
    assert!(!result.unwrap());
  }

  #[test]
  fn test_collector_new_creates_components() {
    let temp_file = tempfile::NamedTempFile::new().unwrap();
    let db = Arc::new(Database::new(temp_file.path()).unwrap());

    let collector = Collector::new(db);
    assert!(collector.is_ok());
  }
}
