use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WindowTrackerError {
  #[error("No active window found")]
  NoActiveWindow,
  #[error("Process query failed: {0}")]
  ProcessQueryFailed(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowInfo {
  pub process_name: String,
  pub window_title: String,
  pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub struct WindowTracker;

impl WindowTracker {
  pub fn new() -> Result<Self> {
    Ok(Self)
  }

  #[cfg(windows)]
  pub fn get_active_window_info(&self) -> Result<WindowInfo> {
    use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
    use windows::Win32::System::Threading::OpenProcess;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    unsafe {
      // Get foreground window handle
      let hwnd = GetForegroundWindow();
      if hwnd.is_invalid() {
        return Err(WindowTrackerError::NoActiveWindow.into());
      }

      // Get process ID - this function is available in newer windows-rs
      let mut pid: u32 = 0;
      GetWindowThreadProcessId(hwnd, Some(&mut pid));

      // Open process with PROCESS_QUERY_LIMITED_INFORMATION
      let handle = OpenProcess(
        windows::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
        false,
        pid,
      )
      .map_err(|e| WindowTrackerError::ProcessQueryFailed(e.to_string()))?;

      // Get process name
      let mut name_buffer = [0u16; 260];
      let len = GetModuleBaseNameW(
        handle,
        windows::Win32::Foundation::HMODULE::default(),
        &mut name_buffer,
      );
      let process_name = String::from_utf16_lossy(&name_buffer[..len as usize]);

      // Get window title
      let mut title_buffer = [0u16; 512];
      let len = GetWindowTextW(hwnd, &mut title_buffer);
      let window_title = String::from_utf16_lossy(&title_buffer[..len as usize]);

      // Sanitize window title for privacy
      let window_title = Self::sanitize_title(&window_title);

      Ok(WindowInfo {
        process_name,
        window_title,
        timestamp: Utc::now(),
      })
    }
  }

  #[cfg(not(windows))]
  pub fn get_active_window_info(&self) -> Result<WindowInfo> {
    Err("Window tracking is only supported on Windows".into())
  }

  fn sanitize_title(title: &str) -> String {
    // Remove sensitive patterns
    if title.contains("•••") || title.contains("***") {
      return "[Sensitive Content]".to_string();
    }

    // Check for sensitive apps
    let sensitive_apps = [
      "Bank",
      "Finance",
      "Password",
      "Login",
      "1Password",
      "Bitwarden",
      "KeePass",
    ];
    if sensitive_apps.iter().any(|app| title.contains(app)) {
      return "[Protected App]".to_string();
    }

    title.to_string()
  }
}

impl Clone for WindowTracker {
  fn clone(&self) -> Self {
    Self
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_sanitize_title_removes_sensitive_content() {
    // Test password masking patterns
    assert_eq!(WindowTracker::sanitize_title("Login - Password: ••••••••"), "[Sensitive Content]");
    assert_eq!(WindowTracker::sanitize_title("Account *** hidden"), "[Sensitive Content]");
    assert_eq!(WindowTracker::sanitize_title("••••••***"), "[Sensitive Content]");
  }

  #[test]
  fn test_sanitize_title_protected_apps() {
    // Test sensitive app keywords
    assert_eq!(WindowTracker::sanitize_title("Bank of America"), "[Protected App]");
    assert_eq!(WindowTracker::sanitize_title("Finance Dashboard"), "[Protected App]");
    assert_eq!(WindowTracker::sanitize_title("Password Manager"), "[Protected App]");
    assert_eq!(WindowTracker::sanitize_title("Login to Google"), "[Protected App]");
    assert_eq!(WindowTracker::sanitize_title("1Password - My Vault"), "[Protected App]");
    assert_eq!(WindowTracker::sanitize_title("Bitwarden Settings"), "[Protected App]");
    assert_eq!(WindowTracker::sanitize_title("KeePass Database"), "[Protected App]");
  }

  #[test]
  fn test_sanitize_title_preserves_normal_titles() {
    // Test normal titles are preserved
    assert_eq!(WindowTracker::sanitize_title("Visual Studio Code"), "Visual Studio Code");
    assert_eq!(WindowTracker::sanitize_title("My Document - Word"), "My Document - Word");
    assert_eq!(WindowTracker::sanitize_title("Chrome - New Tab"), "Chrome - New Tab");
  }

  #[test]
  fn test_sanitize_title_empty_string() {
    assert_eq!(WindowTracker::sanitize_title(""), "");
  }

  #[test]
  fn test_sanitize_title_special_characters() {
    // Test titles with special characters but no sensitive content
    assert_eq!(WindowTracker::sanitize_title("File @#$% - Test"), "File @#$% - Test");
    assert_eq!(WindowTracker::sanitize_title("日本語 - テスト"), "日本語 - テスト");
    assert_eq!(WindowTracker::sanitize_title("العربية"), "العربية");
  }

  #[test]
  fn test_sanitize_title_unicode_and_emoji() {
    // Test Unicode and emoji
    assert_eq!(WindowTracker::sanitize_title("Hello 🌍 World"), "Hello 🌍 World");
    assert_eq!(WindowTracker::sanitize_title("Test Café"), "Test Café");
  }

  #[test]
  fn test_sanitize_title_very_long_string() {
    // Test with very long title
    let long_title = "A".repeat(10000);
    assert_eq!(WindowTracker::sanitize_title(&long_title), long_title);
  }

  #[test]
  fn test_sanitize_title_priority_sensitive_content() {
    // Sensitive content patterns take priority
    assert_eq!(WindowTracker::sanitize_title("Bank Account: ••••"), "[Sensitive Content]");
  }

  #[test]
  fn test_sanitize_title_whitespace_variants() {
    // Test with various whitespace
    assert_eq!(WindowTracker::sanitize_title("  Bank  of  America  "), "[Protected App]");
    assert_eq!(WindowTracker::sanitize_title("\tPassword\tManager\t"), "[Protected App]");
    assert_eq!(WindowTracker::sanitize_title("\nFinance\n\n"), "[Protected App]");
  }

  #[test]
  fn test_window_tracker_new() {
    let tracker = WindowTracker::new();
    assert!(tracker.is_ok());
  }

  #[test]
  fn test_window_tracker_clone() {
    let tracker1 = WindowTracker::new().unwrap();
    let tracker2 = tracker1.clone();
    // Both should be valid instances
    let _ = tracker1;
    let _ = tracker2;
  }

  #[test]
  fn test_window_info_serialization() {
    let info = WindowInfo {
      process_name: "test.exe".to_string(),
      window_title: "Test Window".to_string(),
      timestamp: Utc::now(),
    };

    let serialized = serde_json::to_string(&info);
    assert!(serialized.is_ok());

    let deserialized: Result<WindowInfo, _> = serde_json::from_str(&serialized.unwrap());
    assert!(deserialized.is_ok());
    let info2 = deserialized.unwrap();
    assert_eq!(info2.process_name, "test.exe");
    assert_eq!(info2.window_title, "Test Window");
  }

  #[test]
  fn test_window_info_clone() {
    let info1 = WindowInfo {
      process_name: "chrome.exe".to_string(),
      window_title: "Google Search".to_string(),
      timestamp: Utc::now(),
    };

    let info2 = info1.clone();
    assert_eq!(info1.process_name, info2.process_name);
    assert_eq!(info1.window_title, info2.window_title);
  }

  #[test]
  #[cfg(not(windows))]
  fn test_get_active_window_info_non_windows() {
    let tracker = WindowTracker::new().unwrap();
    let result = tracker.get_active_window_info();
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "Window tracking is only supported on Windows");
  }
}
