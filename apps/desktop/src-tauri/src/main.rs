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

fn main() {
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
