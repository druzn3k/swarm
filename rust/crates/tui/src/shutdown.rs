//! Shutdown requests from outside the keyboard: SIGTERM, SIGHUP (the
//! terminal went away) and SIGINT. The handler only sets a flag; the event
//! loop checks it every tick (at most 100 ms), then leaves the loop, so the
//! normal exit path runs: final save (`mark_closed` included), terminal
//! restore, exit status 0.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// A shared "please stop" flag.
#[derive(Clone, Debug, Default)]
pub struct Shutdown(Arc<AtomicBool>);

impl Shutdown {
    /// A flag that no signal sets (tests).
    pub fn new() -> Shutdown {
        Shutdown::default()
    }

    /// A flag set by SIGTERM, SIGHUP and SIGINT. (Raw mode turns Ctrl-C
    /// into a key press, which the key map handles; SIGINT comes from
    /// `kill -INT`.)
    #[cfg(unix)]
    pub fn install() -> std::io::Result<Shutdown> {
        use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
        let s = Shutdown::new();
        for sig in [SIGTERM, SIGHUP, SIGINT] {
            signal_hook::flag::register(sig, Arc::clone(&s.0))?;
        }
        Ok(s)
    }

    /// Without signals to catch, only the keyboard quits.
    #[cfg(not(unix))]
    pub fn install() -> std::io::Result<Shutdown> {
        Ok(Shutdown::new())
    }

    /// Asks the loop to stop.
    pub fn request(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    /// Has a stop been asked for?
    pub fn requested(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_flag_starts_clear_and_is_shared() {
        let s = Shutdown::new();
        let other = s.clone();
        assert!(!s.requested());
        other.request();
        assert!(s.requested());
    }

    #[cfg(unix)]
    #[test]
    fn signals_set_the_flag() {
        use signal_hook::consts::{SIGHUP, SIGTERM};
        let s = Shutdown::install().unwrap();
        assert!(!s.requested());
        signal_hook::low_level::raise(SIGTERM).unwrap();
        assert!(s.requested());
        let s = Shutdown::install().unwrap();
        assert!(!s.requested());
        signal_hook::low_level::raise(SIGHUP).unwrap();
        assert!(s.requested());
    }
}
