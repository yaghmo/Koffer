//! Auto-lock timer. Tracks inactivity; ticks until threshold reached.

use std::time::{Duration, Instant};

pub struct AutoLock {
    timeout: Duration,
    last_activity: Instant,
}

impl AutoLock {
    pub fn new(timeout_mins: u8) -> Self {
        Self {
            timeout: Duration::from_secs((timeout_mins as u64) * 60),
            last_activity: Instant::now(),
        }
    }

    pub fn reset(&mut self) {
        self.last_activity = Instant::now();
    }

    /// Returns true if the timer has expired (caller should lock).
    pub fn tick(&mut self) -> bool {
        self.last_activity.elapsed() >= self.timeout
    }

    pub fn set_timeout(&mut self, mins: u8) {
        self.timeout = Duration::from_secs((mins as u64) * 60);
    }

    pub fn timeout_mins(&self) -> u8 {
        (self.timeout.as_secs() / 60) as u8
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    #[test]
    fn new_starts_unexpired() {
        let mut al = AutoLock::new(15);
        assert!(!al.tick());
    }

    #[test]
    fn reset_prevents_expiry() {
        let mut al = AutoLock::new(15);
        al.timeout = Duration::from_millis(10);
        sleep(Duration::from_millis(20));
        assert!(al.tick()); // expired
        al.reset();
        assert!(!al.tick()); // not expired after reset
    }

    #[test]
    fn set_timeout_changes_value() {
        let mut al = AutoLock::new(15);
        al.set_timeout(30);
        assert_eq!(al.timeout_mins(), 30);
    }

    #[test]
    fn timeout_mins_returns_initial_value() {
        let al = AutoLock::new(20);
        assert_eq!(al.timeout_mins(), 20);
    }
}
