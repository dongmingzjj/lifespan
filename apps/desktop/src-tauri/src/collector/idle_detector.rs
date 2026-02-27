use anyhow::Result;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IdleDetectorError {
  #[error("Failed to get last input info")]
  GetLastInputFailed,
}

pub struct IdleDetector;

impl IdleDetector {
  pub fn new() -> Result<Self> {
    Ok(Self)
  }

  pub fn is_idle(&self, threshold: Duration) -> Result<bool> {
    #[cfg(windows)]
    {
      use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
      use windows::Win32::System::SystemInformation::GetTickCount64;

      unsafe {
        let mut lii = LASTINPUTINFO {
          cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
          ..Default::default()
        };

        if GetLastInputInfo(&mut lii).as_bool() {
          let current_tick = GetTickCount64();
          let idle_millis = current_tick.saturating_sub(lii.dwTime as u64);
          Ok(Duration::from_millis(idle_millis) > threshold)
        } else {
          Err(IdleDetectorError::GetLastInputFailed.into())
        }
      }
    }

    #[cfg(not(windows))]
    {
      // On non-Windows, assume not idle
      Ok(false)
    }
  }
}

impl Clone for IdleDetector {
  fn clone(&self) -> Self {
    Self
  }
}
