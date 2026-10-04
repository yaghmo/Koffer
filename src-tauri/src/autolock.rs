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

    pub fn timeout_secs(&self) -> u64 {
        self.timeout.as_secs()
    }

    pub fn remaining_secs(&self) -> u64 {
        self.timeout.saturating_sub(self.last_activity.elapsed()).as_secs()
    }
}

/// How late a watchdog tick may run before the gap counts as sleep.
const SLEEP_GAP: Duration = Duration::from_secs(60);

/// Was the machine asleep between two watchdog ticks, going by the wall
/// clock? The idle timer cannot tell: on Linux and macOS its clock stops
/// while the machine sleeps, so a laptop closed for hours wakes with the
/// vault as open as it was left.
pub fn woke_from_sleep(tick_gap: Duration) -> bool {
    tick_gap > SLEEP_GAP
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
    fn a_long_gap_between_ticks_is_the_machine_having_slept() {
        assert!(!woke_from_sleep(Duration::from_secs(10)));
        // A busy machine runs the watchdog late, not minutes late.
        assert!(!woke_from_sleep(Duration::from_secs(40)));
        assert!(woke_from_sleep(Duration::from_secs(5 * 60)));
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

    #[test]
    fn remaining_secs_counts_down_and_floors_at_zero() {
        let mut al = AutoLock::new(15);
        al.timeout = Duration::from_millis(20);
        assert!(al.remaining_secs() <= 1);
        sleep(Duration::from_millis(30));
        assert_eq!(al.remaining_secs(), 0);
    }
}
