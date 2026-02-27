use crate::collector::CollectorStatus;
use crate::collector::Collector;
use crate::sync::{SyncClient, SyncStatus, ServerConfig};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Start tracking window usage
#[tauri::command]
pub async fn start_tracking(
    collector: tauri::State<'_, Arc<Mutex<Collector>>>,
) -> Result<(), String> {
    let collector = collector.lock().await;
    collector.start().await.map_err(|e| e.to_string())
}

/// Stop tracking window usage
#[tauri::command]
pub async fn stop_tracking(
    collector: tauri::State<'_, Arc<Mutex<Collector>>>,
) -> Result<(), String> {
    let collector = collector.lock().await;
    collector.stop().await.map_err(|e| e.to_string())
}

/// Get current collector status
#[tauri::command]
pub async fn get_status(
    collector: tauri::State<'_, Arc<Mutex<Collector>>>,
) -> Result<CollectorStatus, String> {
    let collector = collector.lock().await;
    collector.get_status().await.map_err(|e| e.to_string())
}

/// Sync events to server now
#[tauri::command]
pub async fn sync_now(
    sync_client: tauri::State<'_, SyncClient>,
) -> Result<SyncStatus, String> {
    // Perform sync
    let sync_result = sync_client.sync_events().await;

    // Get and return status
    let status = sync_client.get_status().await
        .map_err(|e| e.to_string())?;

    // If sync failed, update error in status
    if let Err(e) = sync_result {
        let error_status = SyncStatus {
            last_error: Some(e.to_string()),
            ..status
        };
        return Ok(error_status);
    }

    Ok(status)
}

/// Get current sync status
#[tauri::command]
pub async fn get_sync_status(
    sync_client: tauri::State<'_, SyncClient>,
) -> Result<SyncStatus, String> {
    sync_client.get_status().await
        .map_err(|e| e.to_string())
}

/// Get server configuration
#[tauri::command]
pub async fn get_server_config(
    sync_client: tauri::State<'_, SyncClient>,
) -> Result<ServerConfig, String> {
    sync_client.get_config().await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No configuration found".to_string())
}

/// Set server configuration
#[tauri::command]
pub async fn set_server_config(
    sync_client: tauri::State<'_, SyncClient>,
    config: ServerConfig,
) -> Result<SyncStatus, String> {
    // Set configuration
    sync_client.set_config(config).await
        .map_err(|e| e.to_string())?;

    // Return updated status
    sync_client.get_status().await
        .map_err(|e| e.to_string())
}
