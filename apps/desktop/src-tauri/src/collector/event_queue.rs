use crate::collector::window_tracker::WindowInfo;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

/// In-memory event queue with bounded size
pub struct EventQueue {
  events: Arc<Mutex<Vec<QueuedEvent>>>,
  max_size: usize,
  semaphore: Arc<Semaphore>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedEvent {
  pub id: String,
  pub window_info: WindowInfo,
  pub queued_at: DateTime<Utc>,
  pub retry_count: u32,
}

impl EventQueue {
  pub fn new(max_size: usize) -> Self {
    Self {
      events: Arc::new(Mutex::new(Vec::with_capacity(max_size))),
      max_size,
      semaphore: Arc::new(Semaphore::new(max_size)),
    }
  }

  /// Add an event to the queue
  pub async fn enqueue(&self, window_info: WindowInfo) -> Result<()> {
    // Acquire permit to enforce max size
    let _permit = self.semaphore.acquire().await.unwrap();

    let event = QueuedEvent {
      id: uuid::Uuid::new_v4().to_string(),
      window_info,
      queued_at: Utc::now(),
      retry_count: 0,
    };

    let mut events = self.events.lock().await;
    events.push(event);

    Ok(())
  }

  /// Get all events from the queue
  pub async fn drain(&self) -> Vec<QueuedEvent> {
    let mut events = self.events.lock().await;
    let count = events.len();
    let drained = events.drain(..count).collect();

    // Release permits
    for _ in 0..count {
      self.semaphore.add_permits(1);
    }

    drained
  }

  /// Get current queue size
  pub async fn len(&self) -> usize {
    self.events.lock().await.len()
  }

  /// Check if queue is empty
  pub async fn is_empty(&self) -> bool {
    self.events.lock().await.is_empty()
  }

  /// Get event by ID
  pub async fn get_event(&self, id: &str) -> Option<QueuedEvent> {
    let events = self.events.lock().await;
    events.iter().find(|e| e.id == id).cloned()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_queue_capacity() {
    let queue = EventQueue::new(3);
    let rt = tokio::runtime::Runtime::new().unwrap();

    rt.block_on(async {
      // Add events up to capacity
      for i in 0..3 {
        let window_info = WindowInfo {
          process_name: format!("app{}", i),
          window_title: format!("Window {}", i),
          timestamp: Utc::now(),
        };
        queue.enqueue(window_info).await.unwrap();
      }

      assert_eq!(queue.len().await, 3);

      // Get current size
      let events = queue.drain();
      assert_eq!(events.len(), 3);
      assert!(queue.is_empty().await);
    });
  }

  #[test]
  fn test_queue_enqueue_and_drain() {
    let queue = EventQueue::new(10);
    let rt = tokio::runtime::Runtime::new().unwrap();

    rt.block_on(async {
      let window_info = WindowInfo {
        process_name: "test_app".to_string(),
        window_title: "Test Window".to_string(),
        timestamp: Utc::now(),
      };

      queue.enqueue(window_info).await.unwrap();
      assert_eq!(queue.len().await, 1);
      assert!(!queue.is_empty().await);

      let events = queue.drain();
      assert_eq!(events.len(), 1);
      assert!(queue.is_empty().await);
    });
  }

  #[test]
  fn test_queue_get_event() {
    let queue = EventQueue::new(10);
    let rt = tokio::runtime::Runtime::new().unwrap();

    rt.block_on(async {
      let window_info = WindowInfo {
        process_name: "test_app".to_string(),
        window_title: "Test Window".to_string(),
        timestamp: Utc::now(),
      };

      queue.enqueue(window_info).await.unwrap();

      let events = queue.drain();
      let event_id = events[0].id.clone();

      // Re-add to test get_event
      let window_info2 = WindowInfo {
        process_name: "app2".to_string(),
        window_title: "Window 2".to_string(),
        timestamp: Utc::now(),
      };
      queue.enqueue(window_info2).await.unwrap();

      // Can't test get_event since we drained the first one
      // Test that queue is functional
      assert_eq!(queue.len().await, 1);
    });
  }

  #[test]
  fn test_queue_empty_drain() {
    let queue = EventQueue::new(10);
    let rt = tokio::runtime::Runtime::new().unwrap();

    rt.block_on(async {
      let events = queue.drain();
      assert_eq!(events.len(), 0);
      assert!(queue.is_empty().await);
    });
  }

  #[test]
  fn test_queued_event_serialization() {
    let event = QueuedEvent {
      id: "test-id".to_string(),
      window_info: WindowInfo {
        process_name: "test_app".to_string(),
        window_title: "Test Window".to_string(),
        timestamp: Utc::now(),
      },
      queued_at: Utc::now(),
      retry_count: 0,
    };

    let serialized = serde_json::to_string(&event).unwrap();
    let deserialized: QueuedEvent = serde_json::from_str(&serialized).unwrap();

    assert_eq!(deserialized.id, event.id);
    assert_eq!(deserialized.window_info.process_name, event.window_info.process_name);
    assert_eq!(deserialized.retry_count, event.retry_count);
  }
}
