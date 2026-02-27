// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod collector;
mod commands;
mod database;
mod encryption;
mod sync;

use collector::Collector;
use std::sync::Arc;
use sync::SyncClient;
use tauri::Manager;

fn init_tracing() {
  use tracing_subscriber::{EnvFilter, fmt, prelude::*};

  let env_filter = EnvFilter::try_from_default_env()
    .unwrap_or_else(|_| EnvFilter::new("info"));

  tracing_subscriber::registry()
    .with(env_filter)
    .with(fmt::layer())
    .init();
}

fn main() {
  // Initialize tracing
  init_tracing();

  tauri::Builder::default()
    .setup(|app| {
      // Initialize database
      let app_data_dir = app.path().app_local_data_dir()
        .expect("Failed to get app data dir");

      let db_path = app_data_dir.join("local.db");

      // Initialize database in a blocking task
      let db = database::Database::new(&db_path)
        .expect("Failed to initialize database");

      let db_arc = Arc::new(db);

      // Initialize collector
      let collector = Collector::new(db_arc.clone())
        .expect("Failed to initialize collector");

      // Initialize sync client
      let sync_client = SyncClient::new(db_arc.clone());

      // Initialize crypto key for sync (use default key for development)
      // In production, this should be derived from user password using Argon2id
      let default_key = b"lifespan-dev-key-32-bytes-long!!";  // 32 bytes for AES-256

      // Initialize crypto key synchronously using block_on
      let rt = tokio::runtime::Runtime::new()
        .expect("Failed to create tokio runtime");
      rt.block_on(async {
        if let Err(e) = sync_client.set_crypto_key(*default_key).await {
          eprintln!("Failed to initialize crypto key: {}", e);
        }
      });

      // Store in app state
      app.manage(Arc::new(tokio::sync::Mutex::new(collector)));
      app.manage(sync_client);

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::start_tracking,
      commands::stop_tracking,
      commands::get_status,
      commands::sync_now,
      commands::get_sync_status,
      commands::get_server_config,
      commands::set_server_config,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
